"""
Automated checks for the exercise app, run in a headless WebKit (Safari's engine)
with an iPhone profile. This is NOT a real iPhone - see README.md.

Run: see tests/README.md
"""
import datetime, json, os, struct, sys, tempfile, traceback, re
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765')
# The address the app is served at while testing: BASE/MOUNT/SUBDIR
MOUNT = os.environ.get('MOUNT', 'Exercise-app')
SUBDIR = os.environ.get('SUBDIR', '')
APP = BASE + '/' + MOUNT + '/' + SUBDIR
CARD = os.environ.get('CARD')   # optional: address of another page on the same site, to check it is not affected
UTC = datetime.timezone.utc
STOP = 'Stop immediately if experiencing chest pain, unusual shortness of breath, dizziness, or sharp pain.'
MON = datetime.datetime(2026, 9, 21, 16, 0, tzinfo=UTC)   # Monday 12:00 in New York


def day(n, hour=16):
    return datetime.datetime(2026, 9, 21 + n, hour, 0, tzinfo=UTC)


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)


AUDIO_MOCK = """
window.__tones = [];
class FakeCtx {
  constructor(){ this.state='running'; this.currentTime=0; this.destination={}; }
  resume(){ return Promise.resolve(); }
  createGain(){ return { gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} }; }
  createOscillator(){ const o={ frequency:{value:0}, type:'', connect(){}, start(t){ window.__tones.push({f:o.frequency.value}); }, stop(t){} }; return o; }
}
window.AudioContext = FakeCtx; window.webkitAudioContext = FakeCtx;
"""
# A phone whose audio is asleep until it is woken up by resume(), and which reports an audio session
AUDIO_SLEEPY = """
window.__tones = []; window.__resumes = 0;
class SleepyCtx {
  constructor(){ this.state='suspended'; this.currentTime=0; this.destination={}; window.__ctx = this; }
  resume(){ window.__resumes++; this.state='running'; if(this.onstatechange) this.onstatechange(); return Promise.resolve(); }
  createGain(){ return { gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} }; }
  createOscillator(){ const o={ frequency:{value:0}, type:'', connect(){}, start(t){ window.__tones.push({f:o.frequency.value}); }, stop(t){} }; return o; }
}
window.AudioContext = SleepyCtx; window.webkitAudioContext = SleepyCtx;
Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
"""
WAKE_MOCK = """
window.__locks = [];
Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
  request: async () => { const l = { released:false, _f:null, release(){ this.released=true; if(this._f) this._f(); return Promise.resolve(); },
    addEventListener(e,f){ this._f=f; } }; window.__locks.push(l); return l; } } });
"""
NO_WAKE = "delete Navigator.prototype.wakeLock;"
NO_SHARE = "Object.defineProperty(navigator,'share',{configurable:true,value:undefined}); Object.defineProperty(navigator,'canShare',{configurable:true,value:undefined});"
MOCK_SHARE = """
window.__shared = null;
Object.defineProperty(navigator,'canShare',{configurable:true,value:(d)=>!!(d && d.files)});
Object.defineProperty(navigator,'share',{configurable:true,value: async (d)=>{ window.__shared = { name: d.files[0].name, type: d.files[0].type, text: await d.files[0].text() }; }});
"""
NO_STORAGE = "Storage.prototype.setItem = function(){ throw new DOMException('blocked','QuotaExceededError'); };"


class Session:
    def __init__(self, p, when=MON, tz='America/New_York', sw=False, scripts=(), width=None, reduced=False, pause=False, clock=True):
        self.browser = p.webkit.launch()
        kw = dict(p.devices['iPhone 13'])
        if width:
            kw['viewport'] = {'width': width, 'height': 700}
        self.ctx = self.browser.new_context(**kw, timezone_id=tz, accept_downloads=True,
                                            service_workers='allow' if sw else 'block',
                                            reduced_motion='reduce' if reduced else 'no-preference')
        for s in scripts:
            self.ctx.add_init_script(s)
        self.page = self.ctx.new_page()
        self.errors, self.foreign = [], []
        self.page.on('console', lambda m: self.errors.append(m.text) if m.type == 'error' else None)
        self.page.on('pageerror', lambda e: self.errors.append('pageerror: ' + str(e)))
        self.page.on('request', lambda r: self.foreign.append(r.url) if not r.url.startswith(BASE) and not r.url.startswith('blob:') and not r.url.startswith('data:') else None)
        if clock:
            self.page.clock.install(time=when)
        if pause:
            self.page.clock.pause_at(when + datetime.timedelta(seconds=1))
        self.page.goto(APP)

    def consent(self):
        p = self.page
        p.check('#consent-box')
        p.click('[data-fid=consent-go]')
        return self

    def tab(self, name):
        self.page.click('#tabs a[data-tab=%s]' % name)

    def close(self):
        self.browser.close()

    def data(self):
        return self.page.evaluate("()=>JSON.parse(localStorage.getItem('mikeExercise.data'))")

    def set_state(self, js):
        self.page.evaluate("()=>{const d=mikeExerciseApp.store.data; %s; mikeExerciseApp.store.save(); mikeExerciseApp.render();}" % js)

    def week(self, w):
        self.set_state("d.currentWeek=%d" % w)


def first_lines(page, sel):
    return page.eval_on_selector_all(sel, "els=>els.map(e=>e.firstChild.textContent.trim())")


def texts(page, sel):
    return page.eval_on_selector_all(sel, "els=>els.map(e=>e.textContent.trim())")


TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


# ---------------------------------------------------------------- first launch
@test
def first_launch_disclaimer(p):
    s = Session(p)
    page = s.page
    ok('Consult your physician before beginning any exercise program.' in page.inner_text('main'), 'disclaimer text')
    ok('I have talked with my physician about starting this program.' in page.inner_text('main'), 'checkbox text')
    ok(page.is_disabled('[data-fid=consent-go]'), 'Continue should be disabled until ticked')
    ok(page.is_hidden('#tabs'), 'tab bar hidden before consent')
    ok(page.is_visible('#safety-btn'), 'Safety button on disclaimer')
    page.check('#consent-box')
    ok(not page.is_disabled('[data-fid=consent-go]'), 'Continue enabled after tick')
    page.uncheck('#consent-box')
    ok(page.is_disabled('[data-fid=consent-go]'), 'Continue disabled again after untick')
    page.check('#consent-box'); page.click('[data-fid=consent-go]')
    ok('Today is Monday' in page.inner_text('main'), 'moves on to Today')
    page.reload()
    ok('Today is Monday' in page.inner_text('main'), 'answer is saved: no disclaimer after reload')
    d = s.data()
    ok(d['consent']['agreed'] is True and d['weekStartDate'] == '2026-09-21', 'consent + week start saved: %s' % d['consent'])
    s.close()


# ---------------------------------------------------------------- schedule
WARM = 'Daily Warm-Up'
COOL = '5-Minute Recovery Cool-Down'
SCHEDULE = {
    0: ('Monday', [WARM, 'Strength A', 'Chair Tai Chi finish', COOL]),
    1: ('Tuesday', [WARM, 'Chair Tai Chi', 'Stretches']),
    2: ('Wednesday', [WARM, 'Brisk Walk', 'Optional Chair Tai Chi', COOL]),
    3: ('Thursday', [WARM, 'Strength B', COOL]),
    4: ('Friday', [WARM, 'Chair Tai Chi', "Today's focus"]),
    5: ('Saturday', [WARM, 'Choose one', 'Your adventure', COOL]),
    6: ('Sunday', [WARM, 'Recovery']),
}


@test
def day_of_week_and_sections(p):
    for n, (name, sections) in SCHEDULE.items():
        s = Session(p, when=day(n)); s.consent()
        page = s.page
        ok(('Today is ' + name) in page.inner_text('#day-heading'), 'heading for ' + name)
        ok('Program week 1 of 8' in page.inner_text('#week-line'), 'week line')
        got = texts(page, 'main h3')
        ok(got == sections, '%s sections %s != %s' % (name, got, sections))
        ok(page.is_visible('main .stopline'), 'red stop line on ' + name)
        ok(STOP in page.inner_text('main .stopline'), 'stop line wording')
        s.close()


@test
def local_date_rolls_over_at_local_midnight(p):
    # 23:30 in Los Angeles on Monday (= 06:30 UTC Tuesday) is still Monday; 00:30 is Tuesday
    late = datetime.datetime(2026, 9, 22, 6, 30, tzinfo=UTC)
    s = Session(p, when=late, tz='America/Los_Angeles'); s.consent()
    ok('Today is Monday' in s.page.inner_text('#day-heading'), 'Monday at 23:30 local')
    s.close()
    early = datetime.datetime(2026, 9, 22, 7, 30, tzinfo=UTC)
    s = Session(p, when=early, tz='America/Los_Angeles'); s.consent()
    ok('Today is Tuesday' in s.page.inner_text('#day-heading'), 'Tuesday at 00:30 local')
    s.close()


@test
def chips_and_per_date_checklists(p):
    s = Session(p); s.consent(); page = s.page
    page.check('#c-warmup\\.march')
    ok('1 of ' in page.inner_text('#tick-count'), 'count updates')
    page.click('[data-fid=chip-1]')
    ok(page.inner_text('#day-heading').strip() == 'Tuesday', 'viewing Tuesday (not "Today is")')
    ok(not page.is_checked('#c-warmup\\.march'), 'Tuesday has its own checklist state')
    page.click('[data-fid=chip-0]')
    ok(page.is_checked('#c-warmup\\.march'), 'Monday still ticked')
    d = s.data()
    ok(d['days']['2026-09-21']['checks'].get('warmup.march') is True, 'saved under the calendar date')
    ok('2026-09-22' not in d['days'] or not d['days']['2026-09-22']['checks'], 'nothing saved for other dates')
    # next day: fresh checklist
    s.set_state("d.days['2026-09-21'].checks['x']=true")
    s.close()


@test
def form_tips_toggle(p):
    s = Session(p); s.consent(); page = s.page
    tip = page.locator('#tip-warmup\\.march')
    ok(tip.is_hidden(), 'tip hidden at first')
    page.click('[data-fid="tipbtn-warmup.march"]')
    ok(tip.is_visible() and 'march seated' in tip.inner_text(), 'tip shows one line')
    ok(page.get_attribute('[data-fid="tipbtn-warmup.march"]', 'aria-expanded') == 'true', 'aria-expanded')
    page.click('[data-fid="tipbtn-warmup.march"]')
    ok(tip.is_hidden(), 'tip hides again')
    s.close()


# ---------------------------------------------------------------- progression
@test
def progression_by_week(p):
    s = Session(p); s.consent(); page = s.page
    expect = {1: (1, 0, 15), 2: (1, 0, 15), 3: (2, 0, 20), 4: (2, 0, 20), 5: (2, 1, 25), 6: (2, 1, 25), 7: (3, 0, 30), 8: (3, 0, 30)}
    for w, (rounds, opt, fri) in expect.items():
        s.week(w)
        page.click('[data-fid=chip-0]')
        heads = [t for t in texts(page, 'main h4')]
        ok(len(heads) == rounds + opt, 'Monday week %d rounds: %s' % (w, heads))
        ok(('Optional' in heads[-1]) == bool(opt), 'optional 3rd round label week %d' % w)
        if opt:
            ok('add when you feel strong and steady' in heads[-1], 'optional wording: ' + heads[-1])
        ok(page.locator('main .round').first.locator('.row').count() == 5, 'five exercises per round')
        ok('5 minutes' in page.inner_text('main'), 'Monday finish stays 5 min')
        page.click('[data-fid=chip-3]')
        ok(len(texts(page, 'main h4')) == rounds + opt, 'Thursday week %d rounds' % w)
        page.click('[data-fid=chip-4]')
        ok(('Week %d: %d minutes' % (w, fri)) in page.inner_text('main'), 'Friday minutes week %d' % w)
        page.click('[data-fid=chip-1]')
        ok('Choose 15 or 20 minutes' in page.inner_text('main'), 'Tuesday unchanged')
        page.click('[data-fid=chip-2]'); ok('Brisk Walk' in page.inner_text('main'), 'Wednesday unchanged')
    s.close()


@test
def strength_content_and_rest_note(p):
    s = Session(p); s.consent(); page = s.page
    body = page.inner_text('main')
    for t in ['Chair Squats', '× 10', 'Wall Push-Ups', 'Standing Calf Raises', '× 15', 'Step-Ups', '× 10 each leg',
              'Countertop Plank', '× 20 seconds', 'Rest as needed between rounds.', 'Start 20-second hold timer', 'Rest 30 seconds', 'Rest 60 seconds']:
        ok(t in body, 'Strength A missing: ' + t)
    page.click('[data-fid=chip-3]')
    body = page.inner_text('main')
    for t in ['Sit-to-Stand', 'Wall Push-Ups', '× 12', 'Supported Lunges', '× 8 each side', 'Bird Dog (supported)', 'Standing Knee Raises', '× 10 each side']:
        ok(t in body, 'Strength B missing: ' + t)
    page.click('[data-fid="tipbtn-r1.bird"]')
    tip = page.inner_text('#tip-r1\\.bird')
    ok('Floor version only if comfortable getting down to and up from the floor' in tip, 'bird dog floor caveat')
    s.close()


@test
def day_specific_controls(p):
    # Tuesday
    s = Session(p, when=day(1)); s.consent(); page = s.page
    ok(page.get_attribute('[data-fid=pick-tue-15]', 'aria-pressed') == 'true', 'Tuesday default 15')
    page.click('[data-fid=pick-tue-20]')
    ok('20 minutes' in page.inner_text('#c-taichi\\.tue >> xpath=ancestor::label'), 'Tuesday 20 chosen')
    ok(page.get_attribute('[data-fid=pick-hold-30]', 'aria-pressed') == 'true', 'stretch hold default 30')
    for hold in (20, 25, 30):
        page.click('[data-fid=pick-hold-%d]' % hold)
        ok(('%d seconds each side' % hold) in page.inner_text('#c-stretch\\.neck >> xpath=ancestor::label'), 'hold %d' % hold)
    ok('each side' not in page.inner_text('#c-stretch\\.chest >> xpath=ancestor::label'), 'chest stretch has no sides')
    labels = first_lines(page, 'main .card:last-of-type .check .label')
    ok(labels == ['Neck Stretch', 'Chest Stretch', 'Hip Stretch', 'Hamstring Stretch'], 'stretch order %s' % labels)
    ok(page.locator('main h3', has_text=COOL).count() == 0, 'no cool-down on Tuesday')
    s.close()
    # Wednesday
    s = Session(p, when=day(2)); s.consent(); page = s.page
    ok(page.input_value('#walk-minutes') == '30', 'walk default 30')
    opts = page.eval_on_selector_all('#walk-minutes option', 'o=>o.map(x=>+x.value)')
    ok(opts[0] == 20 and opts[-1] == 40, 'walk range 20..40: %s' % opts)
    page.select_option('#walk-minutes', '40')
    ok('40 minutes' in page.inner_text('#c-walk\\.main >> xpath=ancestor::label'), 'walk 40')
    ok('could talk but not sing' in page.inner_text('main'), 'brisk definition')
    ok(page.locator('#c-taichi\\.wed').count() == 0, 'optional Tai Chi off by default')
    page.select_option('#wed-taichi', '7')
    ok(page.locator('#c-taichi\\.wed').count() == 1, 'optional Tai Chi appears when picked')
    s.close()
    # Friday focus list
    s = Session(p, when=day(4)); s.consent(); page = s.page
    labels = first_lines(page, 'main .card:last-of-type .check .label')
    ok(labels == ['Posture', 'Breathing', 'Weight Shifting', 'Balance', 'Coordination'], 'focus list %s' % labels)
    s.close()
    # Saturday
    s = Session(p, when=day(5)); s.consent(); page = s.page
    radios = texts(page, 'input[name=adventure] ~ .label')
    ok(radios == ['Walking', 'Hiking', 'Gardening', 'Cycling', 'Swimming', 'Other'], 'adventure choices %s' % radios)
    ok(page.is_hidden('#adv-other'), 'Other text box hidden')
    page.check('#adv-Other')
    ok(page.is_visible('#adv-other'), 'Other text box visible')
    page.fill('#adv-other', 'Kayaking')
    page.reload()
    ok(page.is_checked('#adv-Other') and page.input_value('#adv-other') == 'Kayaking', 'adventure choice saved')
    ok('30 to 60 minutes' in page.inner_text('main'), 'goal shown')
    s.close()
    # Sunday
    s = Session(p, when=day(6)); s.consent(); page = s.page
    labels = first_lines(page, 'main .card:nth-of-type(2) .check .label')
    ok(labels == ['Gentle Stretching', 'Easy Walking', 'Deep Breathing'], 'recovery items %s' % labels)
    ok('10 to 20 minutes' in page.inner_text('main'), 'recovery duration')
    s.close()


# ---------------------------------------------------------------- week moves
@test
def manual_week_advance(p):
    s = Session(p); s.consent(); page = s.page
    s.tab('checkin')
    mv = '[data-fid=move-up]'
    ok('Move up to Week 2' in page.inner_text(mv), 'button label')
    ok(page.is_disabled(mv), 'disabled at start')
    ok('If any box is unchecked, repeat the week. That is smart training, not falling behind.' in page.inner_text('main'), 'repeat text')
    ready = texts(page, 'input[id^=ready-] ~ .label')
    ok(ready == ["Last week's workouts felt comfortable, with no sharp or lingering pain", 'I could talk comfortably during exercise',
                 'My form stayed smooth and controlled', 'I recovered well before my next session'], 'ready text %s' % ready)
    for i in range(3):
        page.check('#ready-%d' % i)
        ok(page.is_disabled(mv), 'still disabled with %d ticked' % (i + 1))
    page.check('#ready-3')
    ok(not page.is_disabled(mv), 'enabled with all four')
    page.uncheck('#ready-1')
    ok(page.is_disabled(mv), 'disabled again after untick')
    page.check('#ready-1')
    # nothing moves automatically, even 40 days later
    d = s.data(); ok(d['currentWeek'] == 1, 'still week 1')
    page.click(mv)
    d = s.data()
    ok(d['currentWeek'] == 2 and d['weekStartDate'] == '2026-09-21', 'moved to week 2')
    ok(d['readyChecks'] == [False] * 4, 'boxes reset for the new week')
    ok('Move up to Week 3' in page.inner_text(mv) and page.is_disabled(mv), 'next button locked again')
    s.tab('today')
    ok('Program week 2 of 8' in page.inner_text('#week-line'), 'Today shows week 2')
    s.close()


@test
def never_advances_by_itself_and_banner(p):
    s = Session(p); s.consent(); page = s.page
    ok(page.locator('#week-banner').count() == 0, 'no banner on day 0')
    s.set_state("d.weekStartDate='2026-09-15'")           # 6 days ago
    ok(page.locator('#week-banner').count() == 0, 'no banner after 6 days')
    s.set_state("d.weekStartDate='2026-09-14'")           # 7 days ago
    b = page.locator('#week-banner')
    ok(b.count() == 1 and 'A week has passed. Ready to move up or repeat?' in b.inner_text(), 'banner at 7 days')
    ok(b.locator('a').get_attribute('href') == '#checkin', 'banner only links to check-in')
    ok(s.data()['currentWeek'] == 1, 'banner does not advance the week')
    b.locator('a').click()
    ok('Week check-in' in page.inner_text('main'), 'link opens check-in')
    s.close()
    # a month later, on a fresh device date, still week 1
    s = Session(p, when=MON + datetime.timedelta(days=40));
    s.page.evaluate("()=>localStorage.setItem('mikeExercise.data', JSON.stringify({consent:{agreed:true,date:'2026-09-21'},currentWeek:1,weekStartDate:'2026-09-21'}))")
    s.page.reload()
    ok('Program week 1 of 8' in s.page.inner_text('#week-line'), 'week stays 1 after 40 days')
    ok(s.page.locator('#week-banner').count() == 1, 'banner shown')
    s.close()


@test
def repeat_and_go_back(p):
    s = Session(p); s.consent(); page = s.page
    page.click('[data-fid=mark-complete]')
    s.tab('tracker'); page.fill('#notes-0', 'felt good')
    s.tab('today'); page.check('#c-warmup\\.march')
    s.tab('checkin')
    page.click('[data-fid=repeat-week]')
    ok(page.is_visible('.modal'), 'confirmation appears')
    page.click('.modal [data-value=false]')
    ok(s.data()['tracker'][0]['days'][0] is True, 'cancel keeps the ticks')
    page.click('[data-fid=repeat-week]'); page.click('.modal [data-value=true]')
    d = s.data()
    ok(d['tracker'][0]['days'] == [False] * 7, 'day checks cleared')
    ok(d['tracker'][0]['notes'] == 'felt good', 'notes kept')
    ok(d['currentWeek'] == 1 and not d['days'].get('2026-09-21', {}).get('checks'), 'checklist cleared, week unchanged')
    ok(page.locator('[data-fid=go-back]').count() == 0, 'no Go back on week 1')
    for i in range(4): page.check('#ready-%d' % i)
    page.click('[data-fid=move-up]')
    ok(s.data()['currentWeek'] == 2, 'week 2')
    page.click('[data-fid=go-back]')
    ok(page.is_visible('.modal'), 'confirm go back')
    page.click('.modal [data-value=true]')
    ok(s.data()['currentWeek'] == 1, 'back to week 1')
    ok(s.data()['tracker'][0]['notes'] == 'felt good', 'notes still there')
    s.close()


@test
def week_eight_congratulations(p):
    s = Session(p); s.consent(); page = s.page
    s.week(8); s.tab('checkin')
    ok(page.locator('#congrats').count() == 0, 'no congrats before finishing')
    ok('Finish the 8-week program' in page.inner_text('[data-fid=move-up]'), 'week 8 button')
    ok(page.is_disabled('[data-fid=move-up]'), 'locked until ticks')
    for i in range(4): page.check('#ready-%d' % i)
    page.click('[data-fid=move-up]')
    ok(page.is_visible('#congrats') and 'Congratulations' in page.inner_text('#congrats'), 'congratulations shown')
    d = s.data(); ok(d['currentWeek'] == 8 and d['programComplete'] is True, 'stays on week 8')
    s.tab('today')
    ok('Program week 8 of 8' in page.inner_text('#week-line'), 'week 8 settings kept')
    page.click('[data-fid=chip-0]'); ok(len(texts(page, 'main h4')) == 3, '3 rounds')
    page.reload()
    s.tab('checkin'); ok(page.is_visible('#congrats'), 'congrats persists')
    page.click('[data-fid=go-back]'); page.click('.modal [data-value=true]')
    ok(s.data()['currentWeek'] == 7 and s.data()['programComplete'] is False, 'go back clears completion')
    s.close()


# ---------------------------------------------------------------- tracker
@test
def tracker_marking_and_toggling(p):
    s = Session(p, when=day(2)); s.consent(); page = s.page      # Wednesday
    ok(page.inner_text('[data-fid=mark-complete]') == 'Mark today complete', 'button label')
    ok(s.data()['tracker'][0]['days'] == [False] * 7, 'never automatic')
    page.click('[data-fid=mark-complete]')
    ok(s.data()['tracker'][0]['days'][2] is True, 'Wednesday recorded')
    ok(page.is_visible('#done-box') and 'recorded' in page.inner_text('#done-box'), 'confirmation box')
    ok('Wed ✓' in page.inner_text('[data-fid=chip-2]'), 'chip shows check')
    s.tab('tracker')
    cell = '[data-fid=trk-0-2]'
    ok(page.get_attribute(cell, 'aria-pressed') == 'true' and '☑' in page.inner_text(cell), 'tracker shows ☑')
    ok('Week 1' in page.inner_text('.week-card.current h3') and 'This week' in page.inner_text('.week-card.current h3'), 'current week highlighted')
    ok(page.locator('.week-card.current').count() == 1, 'exactly one highlighted week')
    page.click(cell)
    ok(s.data()['tracker'][0]['days'][2] is False and '☐' in page.inner_text(cell), 'tap unticks')
    page.click('[data-fid=trk-3-4]')
    ok(s.data()['tracker'][3]['days'][4] is True, 'any week can be toggled')
    ok(page.locator('.trk-cell').count() == 56, '8 weeks x 7 days')
    s.tab('today')
    ok(page.is_visible('[data-fid=mark-complete]'), 'Today follows the tracker after untick')
    page.click('[data-fid=mark-complete]'); page.click('[data-fid=mark-undo]')
    ok(s.data()['tracker'][0]['days'][2] is False, 'undo works')
    # highlight follows the current week
    s.week(4); s.tab('tracker')
    ok('Week 4' in page.inner_text('.week-card.current h3'), 'highlight moves with the week')
    s.close()


@test
def notes_save_automatically(p):
    s = Session(p); s.consent(); page = s.page
    s.tab('tracker')
    page.fill('#notes-2', 'Knee felt a bit stiff on Tuesday')
    ok(s.data()['tracker'][2]['notes'] == 'Knee felt a bit stiff on Tuesday', 'saved as you type')
    page.reload(); s.tab('tracker')
    ok(page.input_value('#notes-2') == 'Knee felt a bit stiff on Tuesday', 'notes survive reload')
    s.close()


@test
def success_targets(p):
    s = Session(p); s.consent(); page = s.page
    s.tab('checkin')
    n = page.locator('input[id^=target-]').count()
    ok(n == 5, 'five targets, got %d' % n)
    ok(page.locator('[id^=target-date-]').count() == 0, 'no dates yet')
    page.check('#target-1')
    ok('Mon Sep 21, 2026' in page.inner_text('#target-date-1'), 'date filled with today: ' + page.inner_text('#target-date-1'))
    ok(s.data()['targets'][1] == {'done': True, 'date': '2026-09-21'}, 'saved')
    page.reload(); s.tab('checkin')
    ok(page.is_checked('#target-1') and '2026' in page.inner_text('#target-date-1'), 'persisted')
    page.click('[data-fid=target-clear-1]')
    ok(not page.is_checked('#target-1') and page.locator('#target-date-1').count() == 0, 'cleared')
    ok(s.data()['targets'][1] == {'done': False, 'date': None}, 'cleared in storage')
    page.check('#target-3'); page.uncheck('#target-3')
    ok(s.data()['targets'][3]['date'] is None, 'unticking clears the date')
    s.close()


@test
def persistence_after_reload(p):
    s = Session(p, when=day(1)); s.consent(); page = s.page
    page.click('[data-fid=pick-tue-20]'); page.click('[data-fid=pick-hold-25]')
    page.check('#c-warmup\\.toes'); page.check('#c-stretch\\.hip')
    page.click('[data-fid=mark-complete]')
    page.reload()
    ok(page.is_checked('#c-warmup\\.toes') and page.is_checked('#c-stretch\\.hip'), 'ticks persist')
    ok(page.get_attribute('[data-fid=pick-tue-20]', 'aria-pressed') == 'true', 'Tuesday choice persists')
    ok(page.get_attribute('[data-fid=pick-hold-25]', 'aria-pressed') == 'true', 'hold choice persists')
    ok(page.is_visible('#done-box'), 'complete persists')
    s.close()


# ---------------------------------------------------------------- data screen
@test
def export_import_roundtrip(p):
    tmp = tempfile.mkdtemp()
    # (a) download path (no share sheet available)
    s = Session(p, scripts=[NO_SHARE]); s.consent(); page = s.page
    page.click('[data-fid=mark-complete]'); page.check('#c-warmup\\.march')
    s.tab('checkin'); page.check('#target-0')
    s.tab('tracker'); page.fill('#notes-1', 'round trip')
    s.tab('data')
    ok('Last backed up: never' in page.inner_text('#last-backup'), 'never backed up yet')
    ok('saved only on this iPhone' in page.inner_text('main') and 'clearing Safari data can erase it' in page.inner_text('main'), 'explanation sentence')
    before = s.data()
    with page.expect_download() as dl:
        page.click('[data-fid=export]')
    path = os.path.join(tmp, dl.value.suggested_filename)
    dl.value.save_as(path)
    ok(dl.value.suggested_filename == 'mike-exercise-backup-2026-09-21.json', 'file name ' + dl.value.suggested_filename)
    payload = json.load(open(path))
    ok(payload['app'] == 'mikeExercise.backup' and payload['data'] == before, 'file holds the saved data')
    ok('Mon Sep 21, 2026' in page.inner_text('#last-backup'), 'last backed up date shown')
    # wipe, then restore from the file
    page.click('[data-fid=reset]'); page.click('.modal [data-value=true]')
    ok(page.is_visible('#consent-box'), 'reset returns to the disclaimer')
    page.check('#consent-box'); page.click('[data-fid=consent-go]'); s.tab('data')
    ok(s.data()['tracker'][0]['days'][0] is False, 'data really gone')
    page.set_input_files('#import-file', path)
    page.wait_for_selector('.modal', timeout=5000)
    ok(page.is_visible('.modal'), 'restore asks first')
    page.click('.modal [data-value=false]')
    ok(s.data()['tracker'][0]['days'][0] is False, 'cancel keeps current')
    page.set_input_files('#import-file', path)
    page.wait_for_selector('.modal', timeout=5000)
    page.click('.modal [data-value=true]')
    after = s.data()
    ok(after == before, 'round trip identical')
    s.tab('today'); ok(page.is_checked('#c-warmup\\.march'), 'restored checklist shows')
    # bad files
    bad = os.path.join(tmp, 'bad.json'); open(bad, 'w').write('not json at all')
    s.tab('data'); page.set_input_files('#import-file', bad); page.wait_for_selector('.modal', timeout=5000)
    ok('not a readable backup' in page.inner_text('.modal'), 'junk file rejected'); page.click('.modal [data-value=true]')
    other = os.path.join(tmp, 'other.json'); open(other, 'w').write('{"hello": 1}')
    page.set_input_files('#import-file', other); page.wait_for_selector('.modal', timeout=5000)
    ok('not a backup from this app' in page.inner_text('.modal'), 'wrong file rejected'); page.click('.modal [data-value=true]')
    weird = os.path.join(tmp, 'weird.json')
    json.dump({'app': 'mikeExercise.backup', 'data': {'currentWeek': 99, 'days': {'nope': 1}, 'tracker': 'x',
                                                        'prefs': {'walkMinutes': 7}, 'consent': {'agreed': True}}}, open(weird, 'w'))
    page.set_input_files('#import-file', weird); page.wait_for_selector('.modal', timeout=5000); page.click('.modal [data-value=true]')
    d = s.data()
    ok(d['currentWeek'] == 1 and d['prefs']['walkMinutes'] == 30 and len(d['tracker']) == 8 and d['days'] == {}, 'odd values cleaned up: %s' % d['currentWeek'])
    ok(not s.errors, 'console errors: %s' % s.errors)
    s.close()
    # (b) share-sheet path
    s = Session(p, scripts=[MOCK_SHARE]); s.consent(); page = s.page
    page.click('[data-fid=mark-complete]'); s.tab('data')
    page.click('[data-fid=export]')
    page.wait_for_function('window.__shared !== null')
    sh = page.evaluate('window.__shared')
    ok(sh['name'].endswith('.json') and sh['type'] == 'application/json' and json.loads(sh['text'])['app'] == 'mikeExercise.backup', 'shared a JSON file')
    ok('Mon Sep 21, 2026' in page.inner_text('#last-backup'), 'share marks backed up')
    s.close()


@test
def reset_all(p):
    s = Session(p); s.consent(); page = s.page
    page.evaluate("()=>localStorage.setItem('swoop-scorekeeper-state-v1','{\"card\":\"game\"}')")
    page.click('[data-fid=mark-complete]'); s.tab('data')
    page.click('[data-fid=reset]')
    ok(page.is_visible('.modal') and 'cannot be undone' in page.inner_text('.modal'), 'confirmation')
    page.keyboard.press('Escape')
    ok(page.locator('.modal').count() == 0 and s.data()['tracker'][0]['days'][0] is True, 'Escape cancels')
    page.click('[data-fid=reset]'); page.click('.modal [data-value=false]')
    ok(s.data()['tracker'][0]['days'][0] is True, 'Cancel keeps data')
    page.click('[data-fid=reset]'); page.click('.modal [data-value=true]')
    keys = page.evaluate("()=>Object.keys(localStorage)")
    ok([k for k in keys if k.startswith('mikeExercise.')] == [], 'all our keys removed: %s' % keys)
    ok('swoop-scorekeeper-state-v1' in keys, "card game's data untouched by Reset")
    ok(page.is_visible('#consent-box'), 'back to disclaimer')
    s.close()


@test
def storage_unavailable_warning(p):
    s = Session(p, scripts=[NO_STORAGE]); page = s.page
    ok(page.is_visible('#banners .warn'), 'warning banner visible')
    ok('not letting the app save' in page.inner_text('#banners'), 'clear wording')
    s.consent()
    ok('Today is Monday' in page.inner_text('main'), 'app still usable')
    ok(page.is_visible('#banners .warn'), 'banner stays')
    s.close()
    s = Session(p); s.consent()
    ok(s.page.locator('#banners .warn').count() == 0, 'no banner when storage works')
    s.close()


# ---------------------------------------------------------------- timers
def clock_text(page):
    return page.inner_text('.g-clock').strip()


def guided_open(page):
    return page.locator('.guided').count() == 1


def tone_counts(page):
    return page.evaluate("()=>window.__tones.map(t=>t.f)")


def go_hidden(page, hidden):
    page.evaluate("""(h)=>{ Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>h?'hidden':'visible'});
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>h}); document.dispatchEvent(new Event('visibilitychange')); }""", hidden)


@test
def timer_accuracy_pause_and_background(p):
    s = Session(p, scripts=[AUDIO_MOCK, WAKE_MOCK], pause=True); s.consent(); page = s.page
    page.click('[data-fid=go-warmup]')
    ok(guided_open(page), 'guided opens')
    ok('March in Place' in page.inner_text('.g-name'), 'first step name')
    ok(clock_text(page) == '2:00', 'starts at 2:00, got ' + clock_text(page))
    ok('Next up: Shoulder Rolls' in page.inner_text('.g-next'), 'next-up shown')
    page.clock.run_for(30000)
    ok(clock_text(page) == '1:30', '30s later: ' + clock_text(page))
    page.click('[data-fid=g-pause]')
    ok('Paused' in page.inner_text('.g-body'), 'paused tag')
    page.clock.run_for(20000)
    page.click('[data-fid=g-pause]')
    ok(clock_text(page) == '1:30', 'pause holds the time: ' + clock_text(page))
    # phone locks for 60 seconds: time jumps, no ticks fire
    go_hidden(page, True)
    page.clock.fast_forward(60000)
    go_hidden(page, False)
    ok(clock_text(page) == '0:30', 'after a 60s background jump: ' + clock_text(page))
    # beeps for the last 3 seconds, then a chime and a visual "Time's up"
    page.clock.run_for(26000)
    ok(tone_counts(page) == [], 'no sound before the last 3 seconds: %s' % tone_counts(page))
    page.clock.run_for(4300)
    tones = tone_counts(page)
    ok(tones[:3] == [880, 880, 880] and tones[3:] == [660, 880, 1320], 'three beeps then chime: %s' % tones)
    ok(page.locator('.guided.timesup').count() == 1 and "Time's up!" in page.inner_text('.g-big'), "visual Time's up")
    bg = page.evaluate("()=>getComputedStyle(document.querySelector('.guided')).backgroundColor")
    page.clock.run_for(2100)
    ok('Shoulder Rolls' in page.inner_text('.g-name') and page.inner_text('[data-fid=g-done]') == 'Done', 'moves on to the reps step')
    ok('10 forward, then 10 backward' in page.inner_text('.g-reps'), 'reps text')
    ok('Roll big and slow: up, back, and down; keep your neck relaxed' in page.inner_text('.g-coach'), 'coaching line')
    ok(STOP in page.inner_text('.g-foot'), 'stop line on timer screen')
    ok(page.is_visible('[data-fid=g-safety]'), 'Safety on timer screen')
    # mute
    page.click('[data-fid=g-mute]')
    ok('Off' in page.inner_text('[data-fid=g-mute]') and 'off' in page.get_attribute('[data-fid=g-mute]', 'aria-label'), 'mute label')
    ok(s.data()['prefs']['mute'] is True, 'mute remembered')
    ok(not s.errors, s.errors); ok(not s.foreign, s.foreign)
    s.close()


@test
def sound_wake_lock_and_mute(p):
    s = Session(p, scripts=[AUDIO_MOCK, WAKE_MOCK], pause=True); s.consent(); page = s.page
    page.click('[data-fid=go-warmup]')
    page.wait_for_function('window.__locks.length >= 1')
    ok(page.evaluate('window.__locks.length') == 1, 'wake lock requested on start')
    ok(page.is_hidden('.g-foot .g-note >> nth=-1'), 'note hidden when the lock is granted')
    # the phone releases the lock when Safari goes to the background; coming back must ask again
    page.evaluate("window.__locks[0].release()")
    go_hidden(page, True); go_hidden(page, False)
    page.wait_for_function('window.__locks.length >= 2')
    ok(page.evaluate('window.__locks.length') == 2, 'lock requested again on return')
    # muted: no beeps
    page.click('[data-fid=g-mute]')
    page.clock.run_for(120000 - 500)
    page.clock.run_for(600)
    ok(tone_counts(page) == [], 'muted: no sound: %s' % tone_counts(page))
    ok(page.locator('.guided.timesup').count() == 1, 'still shows Time\'s up visually when muted')
    page.click('[data-fid=g-stop]'); page.click('.modal [data-value=true]')
    ok(not guided_open(page), 'stopped')
    ok(page.evaluate('window.__locks[window.__locks.length-1].released'), 'wake lock released on stop')
    s.close()
    # no wake lock support: show the note
    s = Session(p, scripts=[NO_WAKE], pause=True); s.consent(); page = s.page
    page.click('[data-fid=go-warmup]')
    ok('Keep your screen on during workouts.' in page.inner_text('.g-foot'), 'fallback note')
    s.close()


def finish_block(page, until_finished=True, skip_first=False):
    """Drive a guided block to its end using the fake clock."""
    first = True
    for _ in range(80):
        if page.locator('.guided.done').count():
            return
        if page.locator('[data-fid=g-ready]').count():
            page.click('[data-fid=g-ready]')
        elif page.locator('[data-fid=g-done]').count():
            page.click('[data-fid=g-done]')
        elif page.locator('[data-fid=g-side2]').count():
            page.click('[data-fid=g-side2]')
        elif page.locator('.guided.timesup').count():
            page.clock.run_for(2100)
        elif page.locator('.g-clock, .breath-circle').count():
            if skip_first and first:
                page.click('[data-fid=g-skip]'); first = False; continue
            # run the step to its end: ask the page how long is left via the visible clock
            if page.locator('.breath-circle').count():
                page.clock.run_for(51000)
            else:
                t = clock_text(page).split(':')
                secs = int(t[0]) * 60 + int(t[1])
                page.clock.run_for(secs * 1000 + 300)
        else:
            page.clock.run_for(500)
        first = False


@test
def sound_wakes_up_sleeping_audio_and_sets_alert_mode(p):
    s = Session(p, scripts=[AUDIO_SLEEPY], pause=True); s.consent(); page = s.page
    page.click('[data-fid=go-cooldown]')
    ok(page.evaluate('navigator.audioSession.type') == 'transient', 'audio session set to a short-alert mode')
    ok(page.evaluate('window.__resumes') >= 1, 'audio engine woken by the tap')
    # the phone puts audio to sleep again (for example after a phone call); the next cue must wake it first
    first = page.evaluate('window.__resumes')
    page.evaluate("window.__ctx.state = 'suspended'")
    page.clock.run_for(60000)      # skip the slow walk, then let the phone put audio to sleep again just before the end
    page.click('[data-fid=g-skip]')
    page.evaluate("window.__ctx.state = 'suspended'")
    page.clock.run_for(30000 - 1000)
    page.clock.run_for(2000)
    ok(page.evaluate('window.__resumes') > first, 'a sleeping audio engine is woken before a cue')
    tones = tone_counts(page)
    ok(tones[:3] == [880, 880, 880], 'beeps play: %s' % tones)
    s.close()


@test
def sound_check_card(p):
    s = Session(p, scripts=[AUDIO_SLEEPY], pause=True); s.consent(); page = s.page
    s.tab('data')
    st = page.inner_text('#sound-status')
    ok('Sound engine:' in st and 'sound is ON' in st, 'status shown: ' + st)
    page.click('[data-fid=sound-test]')
    st = page.inner_text('#sound-status')
    ok('running' in st and 'Alert mode: transient' in st, 'status after test: ' + st)
    tones = tone_counts(page)
    ok(tones == [880, 660, 880, 1320], 'a beep then a chime: %s' % tones)
    page.click('[data-fid=sound-toggle]')
    ok('OFF' in page.inner_text('#sound-status') and 'turn on' in page.inner_text('[data-fid=sound-toggle]'), 'toggle shows off')
    ok(s.data()['prefs']['mute'] is True, 'remembered')
    ok(not s.errors, s.errors)
    s.close()


@test
def guided_finish_needs_confirmation_to_tick(p):
    s = Session(p, scripts=[AUDIO_MOCK], pause=True); s.consent(); page = s.page
    boxes = "input[id^='c-warmup.']"
    page.click('[data-fid=go-warmup]')
    finish_block(page)
    ok('Well done' in page.inner_text('.g-big'), 'summary shown')
    ok(page.locator(boxes + ':checked').count() == 0, 'nothing ticked before confirming')
    ok(page.inner_text('[data-fid=g-tick]') == 'Yes, tick them', 'asks first')
    page.click('[data-fid=g-leave]')
    ok(not guided_open(page) and page.locator(boxes + ':checked').count() == 0, "'No' leaves the list unticked")
    page.click('[data-fid=go-warmup]')
    finish_block(page)
    page.click('[data-fid=g-tick]')
    ok(page.locator(boxes + ':checked').count() == 8, "'Yes' ticks all 8: %d" % page.locator(boxes + ':checked').count())
    s.close()
    # skipping a step means that step is not ticked
    s = Session(p, scripts=[AUDIO_MOCK], pause=True); s.consent(); page = s.page
    page.click('[data-fid=go-warmup]')
    page.click('[data-fid=g-skip]')
    finish_block(page)
    page.click('[data-fid=g-tick]')
    ok(page.locator(boxes + ':checked').count() == 7 and not page.is_checked('#c-warmup\\.march'), 'skipped step stays unticked')
    s.close()
    # Stop ticks nothing and Cancel keeps going
    s = Session(p, scripts=[AUDIO_MOCK], pause=True); s.consent(); page = s.page
    page.click('[data-fid=go-warmup]')
    page.clock.run_for(10000)
    page.click('[data-fid=g-stop]')
    ok(page.is_visible('.modal'), 'stop asks first')
    page.click('.modal [data-value=false]')
    ok(guided_open(page) and clock_text(page) == '1:50', 'cancel resumes where it was: ' + clock_text(page))
    page.click('[data-fid=g-stop]'); page.click('.modal [data-value=true]')
    ok(not guided_open(page) and page.locator(boxes + ':checked').count() == 0, 'stopped: nothing ticked')
    s.close()


@test
def breathing_and_sides(p):
    s = Session(p, scripts=[AUDIO_MOCK], pause=True); s.consent(); page = s.page
    page.click('[data-fid=go-warmup]')
    for _ in range(7):
        page.click('[data-fid=g-skip]')
    ok('Deep Breathing' in page.inner_text('.g-name') and 'Breath 1 of 5' in page.inner_text('.g-body'), 'breathing step')
    ok('Breathe in' in page.inner_text('.g-body'), 'starts with in')
    ok(page.locator('.breath-circle').count() == 1, 'circle drawn')
    page.clock.run_for(2000)
    mid_in = page.evaluate("()=>getComputedStyle(document.querySelector('.breath-circle')).transform")
    page.clock.run_for(2250)
    ok('Breathe out' in page.inner_text('.g-body'), 'out after 4s')
    page.clock.run_for(6000)
    ok('Breath 2 of 5' in page.inner_text('.g-body') and 'Breathe in' in page.inner_text('.g-body'), 'second breath at 10s: ' + page.inner_text('.g-body'))
    page.clock.run_for(40000)
    ok(page.locator('.guided.timesup').count() == 1, 'ends after 5 breaths (50 s)')
    ok(mid_in != 'none', 'circle scales')
    s.close()
    # sides (cool-down: Calf Stretch)
    s = Session(p, scripts=[AUDIO_MOCK], pause=True); s.consent(); page = s.page
    page.click('[data-fid=go-cooldown]')
    ok('Slow Walk' in page.inner_text('.g-name') and clock_text(page) == '2:00', 'slow walk 2 min')
    ok('Stretch to mild tension, never pain. Never bounce.' in page.inner_text('.g-foot'), 'cool-down reminder')
    page.click('[data-fid=g-skip]')
    ok('Calf Stretch' in page.inner_text('.g-name') and clock_text(page) == '0:30', 'calf 30s')
    ok('Side 1 of 2' in page.inner_text('.g-side'), 'side 1')
    page.clock.run_for(30300)
    page.clock.run_for(2100)
    ok('Switch sides' in page.inner_text('.g-big') and page.locator('.guided.switch').count() == 1, 'switch-sides screen')
    page.clock.run_for(15000)
    ok(page.locator('.guided.switch').count() == 1, 'waits for the user; no timer runs')
    page.click('[data-fid=g-side2]')
    ok('Side 2 of 2' in page.inner_text('.g-side') and clock_text(page) == '0:30', 'side 2 starts at 0:30')
    page.clock.run_for(30300); page.clock.run_for(2100)
    ok('Hamstring Stretch' in page.inner_text('.g-name'), 'moves to the next stretch')
    page.click('[data-fid=g-back]')
    ok('Calf Stretch' in page.inner_text('.g-name'), 'Back goes to the previous step')
    s.close()


@test
def tai_chi_scaling(p):
    s = Session(p); s.consent(); page = s.page
    res = page.evaluate("""()=>{const out={}; for(let m=5;m<=40;m++){ out[m]=mikeExerciseApp.core.scaleTaiChi(m).map(x=>x.seconds); }
       return {out, fin: mikeExerciseApp.core.taiChiFinish5().map(x=>[x.name,x.seconds]),
               names: mikeExerciseApp.core.scaleTaiChi(15).map(x=>x.name)}}""")
    for m, segs in res['out'].items():
        ok(sum(segs) == int(m) * 60, 'total for %s min = %s' % (m, sum(segs)))
        ok(all(x % 15 == 0 and x >= 15 for x in segs), '15-second steps for %s: %s' % (m, segs))
    ok(res['out']['15'] == [120] * 7 + [60], 'base flow is 2,2,2,2,2,2,2,1')
    ok(res['names'] == ['Settling Breath', 'Rising & Sinking Arms', 'Push & Pull', 'Cloud Hands', 'Seated Weight Shifts',
                        'Opposite-Arm March', 'Supported Standing Shift', 'Closing Breaths'], 'segment names')
    ok(res['fin'] == [['Settling Breath', 60], ['Rising & Sinking Arms', 120], ['Cloud Hands', 120]], 'five-minute finish %s' % res['fin'])
    # proportional: every segment of the 30-minute flow is double the base one within one step
    for a, b in zip(res['out']['30'], res['out']['15']):
        ok(abs(a - 2 * b) <= 15, '30 min proportional')
    s.close()


@test
def tai_chi_guided_session(p):
    s = Session(p, when=day(4), scripts=[AUDIO_MOCK], pause=True); s.consent(); page = s.page      # Friday, week 1 => 15 min
    page.click('[data-fid=go-taichi]')
    body = page.inner_text('.g-body')
    for t in ['Use a sturdy chair without wheels, placed against a wall.', 'Sit toward the front edge, feet flat and hip-width apart.',
              'Sit tall with shoulders relaxed.', 'Breathe through the nose and never hold your breath.']:
        ok(t in body, 'set-up item missing: ' + t)
    page.click('[data-fid=g-ready]')
    ok('Settling Breath' in page.inner_text('.g-name') and clock_text(page) == '2:00', 'first segment')
    ok('Hands on thighs' in page.inner_text('.g-coach') or 'hands on thighs' in page.inner_text('.g-coach').lower(), 'cue shown')
    ok('Move as if floating through water: smooth, relaxed, never forced.' in page.inner_text('.g-foot'), 'feel reminder')
    finish_block(page)
    ok('Tick this item' in page.inner_text('.g-body'), 'asks to tick')
    page.click('[data-fid=g-tick]')
    ok(page.is_checked('#c-taichi\\.fri'), 'Friday session ticked after confirming')
    s.close()
    # week 5 => 25 minutes: durations add up
    s = Session(p, when=day(4), scripts=[AUDIO_MOCK], pause=True); s.consent(); s.week(5); page = s.page
    total = page.evaluate("()=>mikeExerciseApp.core.taiChiBlock('2026-09-25',{minutes:25,tickId:'x'}).steps.filter(x=>x.type==='timed').reduce((a,x)=>a+x.seconds,0)")
    ok(total == 25 * 60, 'segments add up to 25 min: %d' % total)
    page.click('[data-fid=go-taichi]'); page.click('[data-fid=g-ready]')
    first = page.evaluate("()=>mikeExerciseApp.core.scaleTaiChi(25)[0].seconds")
    m, sec = divmod(first, 60)
    ok(clock_text(page) == '%d:%02d' % (m, sec), 'first segment shows %d:%02d, got %s' % (m, sec, clock_text(page)))
    s.close()


@test
def other_timers(p):
    s = Session(p, scripts=[AUDIO_MOCK], pause=True); s.consent(); page = s.page
    page.click('[data-fid=hold-1]')
    ok('Countertop Plank hold' in page.inner_text('.g-name') and clock_text(page) == '0:20', '20-second hold')
    page.clock.run_for(20300); page.clock.run_for(2100)
    ok('Tick this item' in page.inner_text('.g-body'), 'asks before ticking the plank')
    page.click('[data-fid=g-tick]')
    ok(page.is_checked('#c-r1\\.plank'), 'plank ticked after confirm')
    page.click('[data-fid=rest-1-30]')
    ok(clock_text(page) == '0:30' and 'Rest' in page.inner_text('.g-name'), 'rest 30')
    page.clock.run_for(30300); page.clock.run_for(2100)
    ok(not guided_open(page), 'rest closes by itself')
    page.click('[data-fid=rest-1-60]'); ok(clock_text(page) == '1:00', 'rest 60')
    page.click('[data-fid=g-stop]'); page.click('.modal [data-value=true]')
    s.close()
    # Saturday stopwatch
    s = Session(p, when=day(5), scripts=[AUDIO_MOCK], pause=True); s.consent(); page = s.page
    page.click('[data-fid=go-stopwatch]')
    ok(clock_text(page) == '0:00', 'stopwatch starts at 0')
    page.clock.run_for(65000)
    ok(clock_text(page) == '1:05', 'stopwatch counts up: ' + clock_text(page))
    go_hidden(page, True); page.clock.fast_forward(120000); go_hidden(page, False)
    ok(clock_text(page) == '3:05', 'stopwatch correct after background: ' + clock_text(page))
    page.click('[data-fid=g-finish]'); page.click('[data-fid=g-tick]')
    ok(page.is_checked('#c-adv\\.done'), 'adventure ticked after confirm')
    s.close()
    # Sunday and Wednesday walk
    s = Session(p, when=day(6), scripts=[AUDIO_MOCK], pause=True); s.consent(); page = s.page
    page.click('[data-fid=pick-sun-20]'); page.click('[data-fid=go-recovery]')
    ok(clock_text(page) == '20:00', 'recovery timer 20 minutes'); s.close()
    s = Session(p, when=day(2), scripts=[AUDIO_MOCK], pause=True); s.consent(); page = s.page
    page.click('[data-fid=go-walk]')
    ok('Brisk Walk' in page.inner_text('.g-name') and clock_text(page) == '30:00', 'walk 30 minutes by default')
    ok('could talk but not sing' in page.inner_text('.g-coach'), 'brisk explained')
    s.close()
    # Tuesday stretches with the chosen hold
    s = Session(p, when=day(1), scripts=[AUDIO_MOCK], pause=True); s.consent(); page = s.page
    page.click('[data-fid=pick-hold-25]'); page.click('[data-fid=go-stretch]')
    ok('Neck Stretch' in page.inner_text('.g-name') and clock_text(page) == '0:25', 'neck 25 s: ' + clock_text(page))
    ok('Ear toward shoulder, never pull.' in page.inner_text('.g-coach'), 'neck tip')
    page.click('[data-fid=g-skip]')
    ok('Chest Stretch' in page.inner_text('.g-name') and 'Side' not in page.inner_text('.g-body'), 'chest has no sides')
    s.close()


@test
def reduced_motion_still_flashes_by_color(p):
    s = Session(p, scripts=[AUDIO_MOCK], reduced=True, pause=True); s.consent(); page = s.page
    page.click('[data-fid=go-warmup]')
    normal = page.evaluate("()=>getComputedStyle(document.querySelector('.guided')).backgroundColor")
    page.clock.run_for(120300)
    st = page.evaluate("()=>{const g=getComputedStyle(document.querySelector('.guided')); return [g.backgroundColor, g.animationName]}")
    ok(st[1] == 'none', 'no animation when reduced motion is on: %s' % st[1])
    ok(st[0] != normal, 'colour still changes at time up: %s vs %s' % (st[0], normal))
    ok("Time's up!" in page.inner_text('.g-big'), "message shown")
    s.close()


# ---------------------------------------------------------------- look & feel
def audit_layout(page, label):
    problems = page.evaluate("""()=>{
      const out=[];
      const vis=e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'};
      // tap targets
      document.querySelectorAll('button, a[href], select, textarea, input[type=text], label.check').forEach(e=>{
        if(!vis(e)||e.closest('.sr-only')) return; const r=e.getBoundingClientRect();
        if(r.height<55.5) out.push('tap target too short ('+Math.round(r.height)+'px): '+(e.textContent||e.id).trim().slice(0,40));
      });
      // text size
      const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      let n; while(n=w.nextNode()){ const t=n.textContent.trim(); if(!t) continue; const e=n.parentElement; if(!vis(e)||e.closest('.sr-only')||e.closest('[aria-hidden=true]:not(.box)')) continue;
        const fs=parseFloat(getComputedStyle(e).fontSize); if(fs<17.95) out.push('text below 18px ('+fs+'): '+t.slice(0,40)); }
      if(document.documentElement.scrollWidth>innerWidth+1) out.push('sideways scroll: '+document.documentElement.scrollWidth+' > '+innerWidth);
      return out;}""")
    ok(not problems, '%s: %s' % (label, problems[:6]))


@test
def accessibility_layout_audit(p):
    for w in (390, 320):
        s = Session(p, width=w)
        page = s.page
        audit_layout(page, 'disclaimer@%d' % w)
        s.consent()
        for n in range(7):
            s.page.evaluate("()=>{mikeExerciseApp.ui.viewDay=%d; mikeExerciseApp.render()}" % n)
            audit_layout(page, 'today %s @%d' % (SCHEDULE[n][0], w))
        s.week(5); page.evaluate("()=>{mikeExerciseApp.ui.viewDay=0; mikeExerciseApp.render()}"); audit_layout(page, 'today week5 @%d' % w)
        for t in ('tracker', 'checkin', 'data'):
            s.tab(t); audit_layout(page, '%s @%d' % (t, w))
        page.click('#safety-btn'); audit_layout(page, 'safety dialog @%d' % w)
        page.keyboard.press('Escape')
        s.tab('today'); page.click('[data-fid=go-warmup]'); audit_layout(page, 'timer @%d' % w)
        s.close()


@test
def safety_button_everywhere(p):
    s = Session(p); page = s.page
    ok(page.is_visible('#safety-btn'), 'disclaimer')
    s.consent()
    for t in ('today', 'tracker', 'checkin', 'data'):
        s.tab(t)
        ok(page.is_visible('#safety-btn'), 'Safety button on ' + t)
    page.click('#safety-btn')
    ok(page.is_visible('.modal') and STOP in page.inner_text('.modal') and 'Consult your physician' in page.inner_text('.modal'), 'safety content')
    page.click('.modal [data-value=true]')
    ok(page.locator('.modal').count() == 0, 'closes')
    s.tab('today'); page.click('[data-fid=go-warmup]')
    page.click('[data-fid=g-safety]')
    ok(page.is_visible('.modal'), 'Safety works from inside the timer')
    page.click('.modal [data-value=true]')
    ok(guided_open(page), 'timer still there after closing Safety')
    s.close()


@test
def keyboard_focus_is_visible(p):
    s = Session(p); s.consent(); page = s.page
    rule = page.evaluate("""()=>{ for (const sh of document.styleSheets) for (const r of sh.cssRules)
        if (r.selectorText === ':focus-visible') return r.cssText; return null; }""")
    ok(rule and '4px solid' in rule, 'clear 4px focus outline rule: %s' % rule)
    s.close()


@test
def install_files_and_paths(p):
    s = Session(p); page = s.page
    html = page.content()
    for meta in ['apple-mobile-web-app-capable', 'apple-mobile-web-app-title', 'apple-mobile-web-app-status-bar-style', 'viewport-fit=cover']:
        ok(meta in html, 'missing ' + meta)
    ok(page.evaluate("()=>document.title") == "Mike's Hybrid Strength, Balance & Mobility Program (Age 50+)", 'page title')
    ok(page.get_attribute('link[rel=apple-touch-icon]', 'href') == 'icons/icon-180.png', 'touch icon relative')
    man = s.ctx.request.get(APP + 'manifest.webmanifest').json()
    ok(man['start_url'] == './' and man['scope'] == './' and man['display'] == 'standalone', 'manifest scoped to this folder: %s' % man)
    ok(man['theme_color'] == '#1B3A57', 'theme colour')
    sizes = {}
    for ic in man['icons']:
        r = s.ctx.request.get(APP + ic['src'])
        ok(r.status == 200, 'icon ' + ic['src'])
        b = r.body(); ok(b[:8] == b'\x89PNG\r\n\x1a\n', 'png')
        w, h = struct.unpack('>II', b[16:24]); sizes[ic['sizes']] = (w, h)
        ok('%dx%d' % (w, h) == ic['sizes'], 'icon really is ' + ic['sizes'])
    ok(set(sizes) == {'180x180', '192x192', '512x512'}, 'icon sizes %s' % sizes)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for f in ('index.html', 'app.js', 'core.js', 'data.js', 'styles.css', 'sw.js', 'manifest.webmanifest'):
        src = open(os.path.join(root, f), encoding='utf-8').read()
        ok(not re.search(r'(?:href|src|url\()\s*=?\s*["\']?/(?!/)', src), 'absolute path in ' + f)
        ok('http://' not in src.replace('http://www.w3.org', '') and 'https://' not in src, 'web address inside ' + f)
    src = open(os.path.join(root, 'core.js'), encoding='utf-8').read() + open(os.path.join(root, 'app.js'), encoding='utf-8').read()
    ok('sessionStorage' not in src and 'indexedDB' not in src, 'only localStorage used')
    ok("STORAGE_PREFIX = 'mikeExercise.'" in open(os.path.join(root, 'data.js'), encoding='utf-8').read(), 'prefix')
    s.close()


@test
def service_worker_scope_and_offline(p):
    s = Session(p, sw=True, clock=False); s.consent(); page = s.page
    page.wait_for_function("navigator.serviceWorker.getRegistration().then(r=>!!(r && r.active))", timeout=15000)
    scope = page.evaluate("()=>navigator.serviceWorker.getRegistration().then(r=>r.scope)")
    ok(scope == APP, 'worker scope is only the exercise folder: %s' % scope)
    regs = page.evaluate("()=>navigator.serviceWorker.getRegistrations().then(rs=>rs.map(r=>r.scope))")
    ok(regs == [APP], 'only one worker registered: %s' % regs)
    page.reload(); page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
    if CARD:
        # another page on the same site is not controlled by our worker
        card = s.ctx.new_page(); card.route('**/*', lambda r: r.continue_() if r.request.url.startswith(BASE) else r.abort())
        card.goto(CARD)
        ok(card.evaluate("()=>navigator.serviceWorker.controller") is None, 'other page not controlled by our worker')
        keys = card.evaluate("()=>Object.keys(localStorage)")
        ok(all(k.startswith('mikeExercise.') for k in keys), 'only our prefixed keys exist: %s' % keys)
        card.close()
    caches = page.evaluate("()=>caches.keys()")
    ok(caches == ['mikeExercise-v2'], 'cache names %s' % caches)
    keys = page.evaluate("()=>caches.open('mikeExercise-v2').then(c=>c.keys()).then(k=>k.map(r=>new URL(r.url).pathname.split('/').pop()||'./'))")
    for f in ('app.js', 'core.js', 'data.js', 'styles.css', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'):
        ok(f in keys, 'saved for offline: ' + f)
    s.close()
    # Real offline check: load from a throw-away server, stop that server, reload.
    import subprocess, time
    app_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    mount_src = app_root if not SUBDIR else os.path.dirname(app_root)
    site = tempfile.mkdtemp()
    os.symlink(mount_src, os.path.join(site, MOUNT))
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '--bind', '127.0.0.1'], cwd=site,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1)
        b = p.webkit.launch(); ctx = b.new_context(**p.devices['iPhone 13'], service_workers='allow'); pg = ctx.new_page()
        pg.goto('http://127.0.0.1:8766/' + MOUNT + '/' + SUBDIR)
        pg.wait_for_function("navigator.serviceWorker.getRegistration().then(r=>!!(r && r.active))", timeout=15000)
        pg.reload(); pg.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
        pg.check('#consent-box'); pg.click('[data-fid=consent-go]')
        srv.terminate(); srv.wait(); time.sleep(0.5)
        pg.reload()
        ok('Today is' in pg.inner_text('main'), 'app opens with the server switched off')
        ok('Program week 1 of 8' in pg.inner_text('#week-line'), 'progress still there offline')
        b.close()
    finally:
        if srv.poll() is None:
            srv.terminate()


@test
def clean_run_no_errors_no_foreign_requests(p):
    s = Session(p, sw=True, scripts=[AUDIO_MOCK], clock=False); s.consent(); page = s.page
    for t in ('tracker', 'checkin', 'data', 'today'):
        s.tab(t)
    page.click('[data-fid=go-warmup]'); page.click('[data-fid=g-skip]'); page.click('[data-fid=g-stop]'); page.click('.modal [data-value=true]')
    page.wait_for_function("navigator.serviceWorker.getRegistration().then(r=>!!(r && r.active))", timeout=15000)
    page.reload()
    ok(not s.errors, 'console errors: %s' % s.errors)
    ok(not s.foreign, 'requests to other addresses: %s' % s.foreign)
    urls = set()
    s.close()


def main():
    only = sys.argv[1:]
    failed = 0
    with sync_playwright() as p:
        for fn in TESTS:
            if only and fn.__name__ not in only:
                continue
            try:
                fn(p)
                print('PASS  ' + fn.__name__)
            except Exception as e:
                failed += 1
                print('FAIL  %s: %s' % (fn.__name__, e))
                if os.environ.get('TRACE'):
                    traceback.print_exc()
    print('\n%d test(s) failed' % failed if failed else '\nAll tests passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
