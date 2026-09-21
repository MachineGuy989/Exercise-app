/*
 * app.js - the screens. Plain JavaScript, no libraries, no network calls.
 */
(function () {
  'use strict';

  var D = window.EXERCISE_DATA;
  var C = window.MikeCore;

  function todayISO() { return C.isoDate(new Date()); }

  var store = C.createStore(todayISO);
  var ui = { viewDay: null, viewDate: null, tips: {} };
  var TABS = ['today', 'tracker', 'checkin', 'data'];

  /* ================= small helpers ================= */

  function $(id) { return document.getElementById(id); }

  function add(parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { add(parent, c); }); return; }
    parent.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  /* el('div', {class:'x', onclick: fn}, child, child...) - text is always inserted as text (safe) */
  function el(tag, props) {
    var e = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'checked') e.checked = true;
      else if (k === 'value') e.value = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }

  function announce(msg) { $('live').textContent = msg; }

  var toastTimer = null;
  function toast(msg) {
    var root = $('toast-root');
    root.textContent = '';
    root.appendChild(el('div', { class: 'toast', role: 'status' }, msg));
    announce(msg);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { root.textContent = ''; }, 2800);
  }

  function save() {
    store.save();
    if (store.saveFailed) renderBanners();
  }

  function dayState(iso) {
    var days = store.data.days;
    if (!days[iso]) days[iso] = { checks: {}, adventure: '', adventureOther: '' };
    return days[iso];
  }

  /* ================= dialogs ================= */

  var modalOpen = false;

  /* Resolves with the clicked button's value, or null if dismissed with Escape */
  function modal(o) {
    return new Promise(function (resolve) {
      var root = $('modal-root');
      var before = document.activeElement;
      modalOpen = true;
      var titleId = 'modal-title';
      var buttons = o.buttons.map(function (b) {
        return el('button', { type: 'button', class: 'btn ' + (b.kind || ''), 'data-value': String(b.value),
          onclick: function () { close(b.value); } }, b.label);
      });
      var box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        el('h2', { id: titleId }, o.title), o.content, el('div', { class: 'btn-row' }, buttons));
      var back = el('div', { class: 'modal-back' }, box);
      function close(v) {
        document.removeEventListener('keydown', onKey, true);
        root.textContent = '';
        modalOpen = false;
        if (before && before.focus && document.contains(before)) { try { before.focus(); } catch (e) { /* ignore */ } }
        resolve(v);
      }
      function onKey(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); close(null); return; }
        if (ev.key === 'Tab') {
          var f = box.querySelectorAll('button, input, select, textarea, a[href]');
          if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
          else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      root.textContent = '';
      root.appendChild(back);
      buttons[0].focus();
    });
  }

  function confirmBox(title, text, okLabel, danger) {
    return modal({
      title: title, content: el('p', {}, text),
      buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' }]
    }).then(function (v) { return v === true; });
  }

  function showSafety() {
    if (modalOpen) return;
    modal({
      title: D.SAFETY.title,
      content: el('div', {},
        el('p', { class: 'stopline' }, D.STOP_LINE),
        el('ul', {}, D.SAFETY.points.map(function (p) { return el('li', {}, p); }))),
      buttons: [{ label: 'Close', value: true, kind: 'primary' }]
    });
  }

  /* ================= sound (Web Audio) ================= */

  var audio = { ctx: null, lastError: '' };

  /* Tell iPhone these are short alert sounds that should be heard (not held back by the
     ringer switch) and that should sit on top of other audio such as music. */
  function setAudioSession() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'transient'; } catch (e) { audio.lastError = String(e); }
  }

  /* Must be called from a tap. Creates the audio engine and wakes it up. */
  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!audio.ctx && AC) {
        audio.ctx = new AC();
        audio.ctx.onstatechange = showSoundStatus;
      }
      setAudioSession();
      var c = audio.ctx;
      if (c) {
        if (c.state !== 'running' && c.resume) {
          var pr = c.resume();
          if (pr && pr.then) pr.then(showSoundStatus, function (e) { audio.lastError = String(e); showSoundStatus(); });
        }
        /* iPhone also wants a real (silent) sound started during the tap */
        if (c.createBuffer && c.createBufferSource) {
          var src = c.createBufferSource();
          src.buffer = c.createBuffer(1, 1, 22050);
          src.connect(c.destination);
          src.start(0);
        }
      }
    } catch (e) { audio.lastError = String(e); }
    showSoundStatus();
  }
  document.addEventListener('touchend', unlockAudio, { passive: true });
  document.addEventListener('click', unlockAudio, { passive: true });

  /* Run fn once the audio engine is really running (waking it first if the phone put it to sleep) */
  function whenAudioReady(fn) {
    var c = audio.ctx;
    if (!c) return;
    function go() { try { fn(); } catch (e) { audio.lastError = String(e); } showSoundStatus(); }
    if (c.state === 'running') { go(); return; }
    try {
      var pr = c.resume();
      if (pr && pr.then) pr.then(go, function (e) { audio.lastError = String(e); showSoundStatus(); });
      else go();
    } catch (e) { audio.lastError = String(e); }
  }

  function tone(freq, startAt, dur, vol) {
    if (store.data.prefs.mute) return;          /* the sound-off setting silences every sound, whatever asked for it */
    var ctx = audio.ctx;
    var osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    var t0 = ctx.currentTime + startAt;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }
  function playBeep() { tone(880, 0, 0.16, 0.7); }
  function playChime() { tone(660, 0, 0.3, 0.8); tone(880, 0.28, 0.3, 0.8); tone(1320, 0.56, 0.8, 0.8); }
  function beep() { if (!store.data.prefs.mute) whenAudioReady(playBeep); }
  function chime() { if (!store.data.prefs.mute) whenAudioReady(playChime); }

  function soundStatusText() {
    var engine = !audio.ctx ? 'not started yet (tap Test sound)' : audio.ctx.state;
    var session = navigator.audioSession ? navigator.audioSession.type : 'not available on this phone';
    return 'Sound engine: ' + engine + '. Alert mode: ' + session + '. In this app, sound is ' +
      (store.data.prefs.mute ? 'OFF' : 'ON') + '.' + (audio.lastError ? ' Problem: ' + audio.lastError : '');
  }
  function showSoundStatus() {
    var e = document.getElementById('sound-status');
    if (e) e.textContent = soundStatusText();
  }

  /* ================= keep the screen awake ================= */

  var wake = { lock: null, state: 'none' };
  function requestWake() {
    try {
      if (!navigator.wakeLock || !navigator.wakeLock.request) { wake.state = 'none'; return; }
      if (wake.lock) return;
      wake.state = 'pending';
      navigator.wakeLock.request('screen').then(function (l) {
        wake.lock = l; wake.state = 'ok';
        if (G.refs && G.refs.wake) G.refs.wake.hidden = true;
        l.addEventListener('release', function () { if (wake.lock === l) { wake.lock = null; } });
        if (!G.runner) { try { l.release(); } catch (e) { /* ignore */ } wake.lock = null; }
      }).catch(function () { wake.state = 'none'; if (G.refs && G.refs.wake) G.refs.wake.hidden = false; });
    } catch (e) { wake.state = 'none'; }
  }
  function releaseWake() {
    if (wake.lock) { try { wake.lock.release(); } catch (e) { /* ignore */ } wake.lock = null; }
    wake.state = 'none';
  }

  /* ================= banners ================= */

  function renderBanners() {
    var b = $('banners');
    b.textContent = '';
    if (!store.ok || store.saveFailed) {
      b.appendChild(el('div', { class: 'warn', role: 'alert', style: 'margin:0.75rem 1rem 0' },
        'Warning: this browser is not letting the app save your progress. Anything you tick will be lost when you close the page. ' +
        'Try opening the app in Safari (not a private tab) and check that Safari is not set to block all website data.'));
    }
  }

  /* ================= building blocks ================= */

  function stopLine() { return el('p', { class: 'stopline' }, D.STOP_LINE); }

  function btn(label, opts) {
    opts = opts || {};
    return el('button', { type: 'button', class: 'btn ' + (opts.kind || '') + (opts.big ? ' big' : ''),
      'data-fid': opts.fid, disabled: opts.disabled, onclick: opts.onclick }, label);
  }

  function picker(name, legend, options, current, onPick) {
    return el('fieldset', { class: 'field' },
      el('legend', {}, legend),
      el('div', { class: 'seg' }, options.map(function (o) {
        return el('button', { type: 'button', 'aria-pressed': o.value === current ? 'true' : 'false',
          'data-fid': 'pick-' + name + '-' + o.value, onclick: function () { onPick(o.value); } }, o.label);
      })));
  }

  function selectField(id, label, options, current, onPick) {
    var sel = el('select', { id: id, 'data-fid': id, onchange: function () { onPick(+sel.value); } },
      options.map(function (o) {
        var opt = el('option', { value: String(o.value) }, o.label);
        if (o.value === current) opt.selected = true;
        return opt;
      }));
    return el('div', { class: 'field' }, el('label', { class: 'lbl', for: id }, label), sel);
  }

  function card(title, meta) {
    var c = el('section', { class: 'card' });
    c.appendChild(el('div', { class: 'card-head' }, el('h3', {}, title)));
    if (meta) c.appendChild(el('p', { class: 'card-meta' }, meta));
    return c;
  }

  /* ================= first launch: disclaimer ================= */

  function renderDisclaimer(main) {
    var cont = btn('Continue', { kind: 'primary big', disabled: true, fid: 'consent-go', onclick: function () {
      store.data.consent = { agreed: true, date: todayISO() };
      store.data.weekStartDate = todayISO();
      save();
      location.hash = '#today';
      render();
    } });
    var box = el('input', { type: 'checkbox', id: 'consent-box', 'data-fid': 'consent-box', onchange: function () {
      if (box.checked) cont.removeAttribute('disabled'); else cont.setAttribute('disabled', '');
    } });
    main.appendChild(el('h1', {}, D.TITLE));
    main.appendChild(el('div', { class: 'card' },
      el('p', { class: 'g-reps', style: 'color:var(--navy);text-align:left' }, D.DISCLAIMER),
      el('div', { class: 'row' }, el('label', { class: 'check', for: 'consent-box' }, box,
        el('span', { class: 'label' }, D.CONSENT_LABEL)))));
    main.appendChild(cont);
    main.appendChild(el('p', { class: 'hint', style: 'margin-top:1rem' }, 'You need to tick the box to continue.'));
  }

  /* ================= TODAY ================= */

  function renderToday(main) {
    var d = store.data;
    var now = new Date();
    var tISO = C.isoDate(now), tIdx = C.dayIndex(now);
    if (ui.viewDate !== tISO) { ui.viewDate = tISO; ui.viewDay = null; }
    var viewIdx = ui.viewDay === null ? tIdx : ui.viewDay;
    var dates = C.weekDates(tISO);
    var viewISO = dates[viewIdx];
    var def = D.DAYS[viewIdx];
    var prog = C.progressionFor(d.currentWeek);
    var trackWeek = d.tracker[d.currentWeek - 1];
    var st = dayState(viewISO);
    var ids = [];

    if (C.daysBetween(d.weekStartDate, tISO) >= 7) {
      main.appendChild(el('div', { class: 'notice', role: 'status', id: 'week-banner' },
        D.WEEK_PASSED + ' ', el('a', { href: '#checkin' }, 'Open the week check-in')));
    }

    main.appendChild(el('h1', {}, D.TITLE));
    main.appendChild(el('h2', { id: 'day-heading' }, viewIdx === tIdx ? 'Today is ' + def.name : def.name));
    main.appendChild(el('p', { class: 'progress-line', id: 'week-line' },
      'Program week ' + d.currentWeek + ' of 8 · ' + def.plan));
    if (viewIdx !== tIdx) {
      main.appendChild(el('p', { class: 'hint' }, 'You are looking at ' + def.name + '. Today is ' + D.DAYS[tIdx].name + '.'));
    }

    main.appendChild(el('div', { class: 'chips', role: 'group', 'aria-label': 'Choose a day' }, D.DAYS.map(function (dd, i) {
      var isDone = trackWeek.days[i];
      return el('button', { type: 'button', 'aria-pressed': i === viewIdx ? 'true' : 'false',
        'aria-current': i === tIdx ? 'date' : null, 'data-fid': 'chip-' + i,
        class: 'chip' + (i === tIdx ? ' today' : '') + (isDone ? ' done' : ''),
        onclick: function () { ui.viewDay = i; render(); } },
        dd.short + (isDone ? ' ✓' : ''), i === tIdx ? el('small', {}, 'Today') : null);
    })));

    main.appendChild(stopLine());
    var count = el('p', { class: 'progress-line', id: 'tick-count', 'aria-live': 'polite' });
    main.appendChild(count);

    function updateCount() {
      var n = 0;
      ids.forEach(function (id) { if (st.checks[id]) n++; });
      count.textContent = n + ' of ' + ids.length + ' ticked';
    }

    /* one checklist row: checkbox + optional "Form tip" + optional extra buttons */
    function row(o) {
      ids.push(o.id);
      var type = o.radio ? 'radio' : 'checkbox';
      var input = el('input', { type: type, id: 'c-' + o.id, 'data-fid': 'c-' + o.id, checked: !!st.checks[o.id],
        onchange: function () {
          if (input.checked) st.checks[o.id] = true; else delete st.checks[o.id];
          save(); updateCount();
        } });
      var wrap = el('div', { class: 'row' });
      var line = el('div', { class: 'row-main' },
        el('label', { class: 'check', for: 'c-' + o.id }, input,
          el('span', { class: 'label' }, o.label, o.sub ? el('span', { class: 'sub' }, o.sub) : null)));
      wrap.appendChild(line);
      if (o.tip) {
        var open = !!ui.tips[o.id];
        var tip = el('p', { class: 'tiptext', id: 'tip-' + o.id, hidden: !open }, o.tip);
        var tb = el('button', { type: 'button', class: 'tipbtn', 'aria-expanded': open ? 'true' : 'false',
          'aria-controls': 'tip-' + o.id, 'data-fid': 'tipbtn-' + o.id, onclick: function () {
            var nowOpen = tb.getAttribute('aria-expanded') !== 'true';
            tb.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
            if (nowOpen) tip.removeAttribute('hidden'); else tip.setAttribute('hidden', '');
            ui.tips[o.id] = nowOpen;
          } }, 'Form tip');
        line.appendChild(tb);
        wrap.appendChild(tip);
      }
      if (o.actions) wrap.appendChild(el('div', { class: 'row-actions' }, o.actions));
      return wrap;
    }

    function startBtn(label, factory, fid) {
      return btn(label, { kind: 'navy', fid: fid, onclick: function () { startGuided(factory(), fid); } });
    }

    /* ---- warm-up ---- */
    function warmupCard() {
      var c = card(D.WARMUP.title, D.WARMUP.minutes + ' minutes. ' + D.SUPPORT_NOTE);
      c.appendChild(el('div', { class: 'btn-row' }, startBtn('Start guided warm-up', function () { return C.warmupBlock(viewISO); }, 'go-warmup')));
      D.WARMUP.steps.forEach(function (s) {
        c.appendChild(row({ id: 'warmup.' + s.id, label: s.name, sub: s.label, tip: s.tip || s.coach }));
      });
      return c;
    }

    /* ---- cool-down ---- */
    function cooldownCard() {
      var c = card(D.COOLDOWN.title, D.STRETCH_NOTE);
      c.appendChild(el('div', { class: 'btn-row' }, startBtn('Start guided cool-down', function () { return C.cooldownBlock(viewISO); }, 'go-cooldown')));
      D.COOLDOWN.steps.forEach(function (s) {
        c.appendChild(row({ id: 'cool.' + s.id, label: s.name, sub: s.label, tip: s.coach }));
      });
      return c;
    }

    /* ---- Chair Tai Chi ---- */
    function taiChiRow(id, label, minutes, finish5) {
      return row({ id: id, label: label, sub: minutes + ' minutes', tip: D.TAICHI_FEEL });
    }
    function taiChiStart(id, minutes, finish5, title, fid) {
      return startBtn('Start guided Chair Tai Chi', function () {
        return C.taiChiBlock(viewISO, { minutes: minutes, finish5: finish5, tickId: id, title: title });
      }, fid);
    }

    /* ---- strength ---- */
    function strengthCard(key) {
      var S = D.STRENGTH[key];
      var rounds = prog.rounds + prog.optionalRounds;
      var c = card(S.title, 'Week ' + d.currentWeek + ': ' + prog.roundsLabel + '. One round is one circuit of these five exercises. ' + D.REST_NOTE);
      for (var r = 1; r <= rounds; r++) {
        (function (r) {
          var isOpt = r > prog.rounds;
          var round = el('div', { class: 'round' }, el('h4', {}, 'Round ' + r,
            isOpt ? el('span', { class: 'opt' }, D.OPTIONAL_ROUND_LABEL) : null));
          S.exercises.forEach(function (ex) {
            var actions = null;
            var rid = 'r' + r + '.' + ex.id;
            if (ex.holdSeconds) {
              actions = btn('Start ' + ex.holdSeconds + '-second hold timer', { kind: 'navy', fid: 'hold-' + r, onclick: function () {
                startGuided(C.timerBlock(viewISO, { title: ex.name, name: ex.name + ' hold', seconds: ex.holdSeconds,
                  coach: ex.tip, tickId: rid }), 'hold-' + r);
              } });
            }
            round.appendChild(row({ id: rid, label: ex.name, sub: ex.reps, tip: ex.tip, actions: actions }));
          });
          round.appendChild(el('p', { class: 'hint', style: 'margin:0.6rem 0 0.25rem' }, 'Optional rest timer:'));
          round.appendChild(el('div', { class: 'btn-row two', style: 'margin-top:0' }, D.REST_CHOICES.map(function (s) {
            return btn('Rest ' + s + ' seconds', { fid: 'rest-' + r + '-' + s, onclick: function () {
              startGuided(C.timerBlock(viewISO, { title: 'Rest timer', name: 'Rest', seconds: s,
                coach: 'Rest as needed. Shake out your arms and legs and breathe easy.' }), 'rest-' + r + '-' + s);
            } });
          })));
          c.appendChild(round);
        })(r);
      }
      return c;
    }

    var sections = [];
    sections.push(warmupCard());

    switch (def.kind) {
      case 'strengthA':
      case 'strengthB':
        sections.push(strengthCard(def.kind === 'strengthA' ? 'A' : 'B'));
        if (def.kind === 'strengthA') {
          var fin = card('Chair Tai Chi finish', '5 minutes. Settling Breath, Rising & Sinking Arms, Cloud Hands.');
          fin.appendChild(el('div', { class: 'btn-row' }, taiChiStart('taichi.finish', 5, true, 'Chair Tai Chi finish', 'go-taichi')));
          fin.appendChild(taiChiRow('taichi.finish', 'Chair Tai Chi finish', 5));
          sections.push(fin);
        }
        break;

      case 'mobility':
        var tm = d.prefs.tueTaiChi;
        var tc = card('Chair Tai Chi', 'Choose 15 or 20 minutes.');
        tc.appendChild(picker('tue', 'Minutes', D.TUESDAY_TAICHI_CHOICES.map(function (m) { return { value: m, label: m + ' minutes' }; }), tm,
          function (v) { d.prefs.tueTaiChi = v; save(); render(); }));
        tc.appendChild(el('div', { class: 'btn-row' }, taiChiStart('taichi.tue', tm, false, 'Chair Tai Chi', 'go-taichi')));
        tc.appendChild(taiChiRow('taichi.tue', 'Chair Tai Chi', tm));
        sections.push(tc);
        var hold = d.prefs.stretchHold;
        var sc = card('Stretches', 'Hold each stretch ' + hold + ' seconds, both sides where it applies. ' + D.STRETCH_NOTE);
        sc.appendChild(picker('hold', 'Hold time', D.STRETCH_HOLDS.map(function (s) { return { value: s, label: s + ' seconds' }; }), hold,
          function (v) { d.prefs.stretchHold = v; save(); render(); }));
        sc.appendChild(el('div', { class: 'btn-row' }, startBtn('Start guided stretches', function () { return C.stretchBlock(viewISO, hold); }, 'go-stretch')));
        D.STRETCHES.forEach(function (s) {
          sc.appendChild(row({ id: 'stretch.' + s.id, label: s.name, sub: hold + ' seconds' + (s.sides ? ' each side' : ''), tip: s.coach }));
        });
        sections.push(sc);
        break;

      case 'walking':
        var wm = d.prefs.walkMinutes;
        var wc = card('Brisk Walk', D.WALK.note);
        var walkOpts = [];
        for (var m = D.WALK.min; m <= D.WALK.max; m += D.WALK.step) walkOpts.push({ value: m, label: m + ' minutes' });
        wc.appendChild(selectField('walk-minutes', 'How long? (20 to 40 minutes)', walkOpts, wm, function (v) { d.prefs.walkMinutes = v; save(); render(); }));
        wc.appendChild(el('div', { class: 'btn-row' }, startBtn('Start guided walk', function () {
          return C.timerBlock(viewISO, { title: 'Brisk Walk', name: 'Brisk Walk', seconds: wm * 60, coach: D.WALK.note, tickId: 'walk.main' });
        }, 'go-walk')));
        wc.appendChild(row({ id: 'walk.main', label: 'Brisk walk', sub: wm + ' minutes', tip: D.WALK.note }));
        sections.push(wc);
        var wt = d.prefs.wedTaiChi;
        var oc = card('Optional Chair Tai Chi', 'If you feel like it, add 5 to 10 minutes.');
        oc.appendChild(selectField('wed-taichi', 'Chair Tai Chi', D.WED_TAICHI_CHOICES.map(function (m) {
          return { value: m, label: m === 0 ? 'Skip it today' : m + ' minutes' };
        }), wt, function (v) { d.prefs.wedTaiChi = v; save(); render(); }));
        if (wt > 0) {
          oc.appendChild(el('div', { class: 'btn-row' }, taiChiStart('taichi.wed', wt, false, 'Chair Tai Chi', 'go-taichi')));
          oc.appendChild(taiChiRow('taichi.wed', 'Chair Tai Chi (optional)', wt));
        }
        sections.push(oc);
        break;

      case 'taichi':
        var fm = prog.taiChi;
        var fc = card('Chair Tai Chi', 'Week ' + d.currentWeek + ': ' + fm + ' minutes.');
        fc.appendChild(el('div', { class: 'btn-row' }, taiChiStart('taichi.fri', fm, false, 'Chair Tai Chi', 'go-taichi')));
        fc.appendChild(taiChiRow('taichi.fri', 'Chair Tai Chi', fm));
        sections.push(fc);
        var fo = card('Today\'s focus', 'Tick each one as you notice it in your practice.');
        D.FRIDAY_FOCUS.forEach(function (f) { fo.appendChild(row({ id: 'focus.' + f.id, label: f.name })); });
        sections.push(fo);
        break;

      case 'adventure':
        var ac = card('Choose one', D.ADVENTURE_GOAL);
        var otherBox = el('input', { type: 'text', id: 'adv-other', maxlength: '60', 'aria-label': 'Describe your activity',
          placeholder: 'What will you do?', value: st.adventureOther, oninput: function () {
            st.adventureOther = otherBox.value; save();
          } });
        var otherWrap = el('div', { class: 'field', hidden: st.adventure !== 'Other' }, otherBox);
        D.ADVENTURES.forEach(function (a) {
          var rb = el('input', { type: 'radio', name: 'adventure', id: 'adv-' + a, 'data-fid': 'adv-' + a, checked: st.adventure === a,
            onchange: function () {
              st.adventure = a; save();
              if (a === 'Other') otherWrap.removeAttribute('hidden'); else otherWrap.setAttribute('hidden', '');
            } });
          ac.appendChild(el('div', { class: 'row' }, el('label', { class: 'check', for: 'adv-' + a }, rb, el('span', { class: 'label' }, a))));
        });
        ac.appendChild(otherWrap);
        sections.push(ac);
        var ad = card('Your adventure', D.ADVENTURE_GOAL + ' A stopwatch is optional.');
        ad.appendChild(el('div', { class: 'btn-row' }, startBtn('Start stopwatch', function () {
          return C.timerBlock(viewISO, { title: 'Adventure stopwatch', name: 'Adventure time', type: 'stopwatch', seconds: 0,
            coach: 'Have fun and keep it comfortable. Tap Finish when you are done.', goal: D.ADVENTURE_GOAL, tickId: 'adv.done' });
        }, 'go-stopwatch')));
        ad.appendChild(row({ id: 'adv.done', label: 'I finished my adventure', sub: '30 to 60 minutes' }));
        sections.push(ad);
        break;

      case 'recovery':
        var rm = d.prefs.sunMinutes;
        var rc = card('Recovery', D.RECOVERY.goal);
        D.RECOVERY.items.forEach(function (name, i) { rc.appendChild(row({ id: 'rec.' + i, label: name })); });
        rc.appendChild(picker('sun', 'Optional timer', D.RECOVERY.timerChoices.map(function (m) { return { value: m, label: m + ' minutes' }; }), rm,
          function (v) { d.prefs.sunMinutes = v; save(); render(); }));
        rc.appendChild(el('div', { class: 'btn-row' }, startBtn('Start timer', function () {
          return C.timerBlock(viewISO, { title: 'Recovery timer', name: 'Recovery time', seconds: rm * 60,
            coach: 'Gentle stretching, easy walking, or deep breathing: your choice.' });
        }, 'go-recovery')));
        sections.push(rc);
        break;
    }

    if (def.cooldown) sections.push(cooldownCard());
    sections.forEach(function (s) { main.appendChild(s); });
    updateCount();

    /* ---- mark complete (never automatic) ---- */
    var isToday = viewIdx === tIdx;
    var finalBox = el('div', { class: 'card' });
    if (!trackWeek.days[viewIdx]) {
      finalBox.appendChild(btn(isToday ? 'Mark today complete' : 'Mark ' + def.name + ' complete', { kind: 'primary big', fid: 'mark-complete', onclick: function () {
        trackWeek.days[viewIdx] = true; save(); render();
        toast('Recorded in your tracker: ' + def.name + ', Week ' + d.currentWeek + '.');
      } }));
    } else {
      finalBox.appendChild(el('div', { class: 'done-box', id: 'done-box' }, '✓ ' + (isToday ? 'Today is' : def.name + ' is') + ' recorded in your tracker'));
      finalBox.appendChild(btn('Undo', { fid: 'mark-undo', onclick: function () {
        trackWeek.days[viewIdx] = false; save(); render();
        toast('Removed from your tracker.');
      } }));
    }
    main.appendChild(finalBox);
  }

  /* ================= TRACKER ================= */

  function renderTracker(main) {
    var d = store.data;
    main.appendChild(el('h2', {}, 'Tracker'));
    main.appendChild(el('p', {}, 'Tap a day to tick or untick it. Days are ticked for you when you tap “Mark today complete”.'));
    main.appendChild(stopLine());
    d.tracker.forEach(function (wk, wi) {
      var isCur = wi + 1 === d.currentWeek;
      var c = el('section', { class: 'week-card' + (isCur ? ' current' : ''), 'aria-label': 'Week ' + (wi + 1),
        'aria-current': isCur ? 'true' : null });
      c.appendChild(el('h3', {}, 'Week ' + (wi + 1), isCur ? el('span', { class: 'badge' }, 'This week') : null));
      var grid = el('div', { class: 'trk-grid' });
      D.DAYS.forEach(function (dd, di) {
        var box = el('span', { class: 'box', 'aria-hidden': 'true' });
        var cell = el('button', { type: 'button', class: 'trk-cell', 'data-fid': 'trk-' + wi + '-' + di },
          el('span', { class: 'full', 'aria-hidden': 'true' }, dd.short), el('span', { class: 'ini', 'aria-hidden': 'true' }, dd.name.charAt(0)), box);
        function paint() {
          var on = wk.days[di];
          cell.setAttribute('aria-pressed', on ? 'true' : 'false');
          cell.setAttribute('aria-label', 'Week ' + (wi + 1) + ', ' + dd.name + ': ' + (on ? 'done' : 'not done'));
          box.textContent = on ? '☑' : '☐';
        }
        cell.addEventListener('click', function () { wk.days[di] = !wk.days[di]; save(); paint(); });
        paint();
        grid.appendChild(cell);
      });
      c.appendChild(grid);
      var nid = 'notes-' + wi;
      var ta = el('textarea', { id: nid, rows: '3', maxlength: '5000', 'data-fid': nid, placeholder: 'How did this week go?' });
      ta.value = wk.notes;
      ta.addEventListener('input', function () { wk.notes = ta.value; save(); });
      c.appendChild(el('label', { class: 'lbl', for: nid, style: 'display:block;font-weight:700;margin-bottom:0.3rem' }, 'Notes for Week ' + (wi + 1)));
      c.appendChild(ta);
      main.appendChild(c);
    });
  }

  /* ================= CHECK-IN / PROGRESS ================= */

  function resetReady() { store.data.readyChecks = [false, false, false, false]; }

  function renderCheckin(main) {
    var d = store.data;
    var w = d.currentWeek;
    var prog = C.progressionFor(w);
    var tISO = todayISO();

    main.appendChild(el('h2', {}, 'Week check-in'));
    main.appendChild(el('p', { class: 'progress-line', id: 'checkin-week' },
      'You are on Week ' + w + ' of 8: ' + prog.roundsLabel + ' per strength day, ' + prog.taiChi + ' minutes of Friday Chair Tai Chi.'));
    var days = C.daysBetween(d.weekStartDate, tISO);
    main.appendChild(el('p', { class: 'hint' }, 'This week started ' + C.niceDate(d.weekStartDate) + (days === 0 ? ' (today).' : ' (' + days + (days === 1 ? ' day' : ' days') + ' ago).')));
    main.appendChild(stopLine());

    if (d.programComplete) {
      main.appendChild(el('div', { class: 'card', id: 'congrats' }, el('h3', {}, D.CONGRATS.title), el('p', { style: 'margin-top:0.5rem' }, D.CONGRATS.text)));
    }

    /* progression table */
    var pc = card('How the weeks progress');
    var table = el('table', { class: 'prog' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Weeks'), el('th', { scope: 'col' }, 'Strength rounds'), el('th', { scope: 'col' }, 'Friday Tai Chi'))),
      el('tbody', {}, D.PROGRESSION.map(function (p) {
        return el('tr', { class: w >= p.from && w <= p.to ? 'current' : '', 'aria-current': w >= p.from && w <= p.to ? 'true' : null },
          el('td', {}, p.weeks), el('td', {}, p.roundsLabel), el('td', {}, p.taiChi + ' min'));
      })));
    pc.appendChild(table);
    if (prog.optionalRounds) pc.appendChild(el('p', { class: 'hint' }, 'The 3rd round: ' + D.OPTIONAL_ROUND_LABEL.toLowerCase() + '.'));
    D.PROGRESSION_NOTES.forEach(function (n) { pc.appendChild(el('p', { class: 'hint' }, n)); });
    main.appendChild(pc);

    /* ready to move up */
    var rc = card('Ready to Move Up?', 'Tick each box that is true for last week.');
    var mv;
    function allReady() { return d.readyChecks.every(function (x) { return x; }); }
    D.READY_TO_MOVE_UP.forEach(function (text, i) {
      var input = el('input', { type: 'checkbox', id: 'ready-' + i, 'data-fid': 'ready-' + i, checked: d.readyChecks[i], onchange: function () {
        d.readyChecks[i] = input.checked; save();
        if (allReady()) mv.removeAttribute('disabled'); else mv.setAttribute('disabled', '');
        hint.hidden = allReady();
      } });
      rc.appendChild(el('div', { class: 'row' }, el('label', { class: 'check', for: 'ready-' + i }, input, el('span', { class: 'label' }, text))));
    });
    rc.appendChild(el('p', { class: 'notice', style: 'margin-top:0.75rem' }, D.REPEAT_NOTE));

    var atEnd = w >= 8;
    var moveLabel = atEnd ? 'Finish the 8-week program' : 'Move up to Week ' + (w + 1);
    mv = btn(moveLabel, { kind: 'primary big', fid: 'move-up', disabled: !allReady() || d.programComplete, onclick: function () {
      if (atEnd) {
        d.programComplete = true; save(); render();
        toast('Congratulations, you finished the program!');
      } else {
        d.currentWeek = w + 1; d.weekStartDate = todayISO(); resetReady(); save();
        window.scrollTo(0, 0); render();
        toast('Welcome to Week ' + (w + 1) + '.');
      }
    } });
    var hint = el('p', { class: 'hint', hidden: allReady() }, 'The button unlocks when all four boxes are ticked.');
    rc.appendChild(el('div', { class: 'btn-row' }, mv, hint));
    rc.appendChild(el('div', { class: 'btn-row' },
      btn('Repeat this week', { fid: 'repeat-week', onclick: function () {
        confirmBox('Repeat Week ' + w + '?', 'This clears the ticked days for Week ' + w + ' and starts the week again today. Your notes are kept.', 'Yes, repeat this week').then(function (ok) {
          if (!ok) return;
          d.tracker[w - 1].days = [false, false, false, false, false, false, false];
          Object.keys(d.days).forEach(function (iso) { if (iso >= d.weekStartDate) delete d.days[iso]; });
          d.weekStartDate = todayISO(); d.programComplete = false; resetReady(); save(); render();
          toast('Week ' + w + ' restarted. Your notes are kept.');
        });
      } }),
      w > 1 ? btn('Go back a week', { fid: 'go-back', onclick: function () {
        confirmBox('Go back to Week ' + (w - 1) + '?', 'Today will show the Week ' + (w - 1) + ' plan. Your ticked days and notes are kept.', 'Yes, go back').then(function (ok) {
          if (!ok) return;
          d.currentWeek = w - 1; d.weekStartDate = todayISO(); d.programComplete = false; resetReady(); save();
          window.scrollTo(0, 0); render();
          toast('You are back on Week ' + (w - 1) + '.');
        });
      } }) : null));
    main.appendChild(rc);

    /* success targets */
    var tc = card('8-Week Success Targets', 'The date fills in when you tick a target. Untick it to clear the date.');
    D.SUCCESS_TARGETS.forEach(function (text, i) {
      var t = d.targets[i];
      var input = el('input', { type: 'checkbox', id: 'target-' + i, 'data-fid': 'target-' + i, checked: t.done, onchange: function () {
        t.done = input.checked; t.date = input.checked ? todayISO() : null; save(); render();
      } });
      var wrap = el('div', { class: 'target' },
        el('div', { class: 'row-main' }, el('label', { class: 'check', for: 'target-' + i }, input, el('span', { class: 'label' }, text))));
      if (t.done) {
        wrap.appendChild(el('div', { class: 'when' },
          el('span', { id: 'target-date-' + i }, 'Date achieved: ' + (t.date ? C.niceDate(t.date) : 'not recorded')),
          btn('Clear', { fid: 'target-clear-' + i, onclick: function () { t.done = false; t.date = null; save(); render(); } })));
      }
      tc.appendChild(wrap);
    });
    main.appendChild(tc);
  }

  /* ================= DATA ================= */

  function download(json, name) {
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function markBackedUp() {
    store.setLastBackup(todayISO());
    if (currentTab() === 'data') render();
    toast('Backup saved.');
  }

  function exportData() {
    var now = new Date();
    var json = JSON.stringify(store.exportPayload(now.toISOString()), null, 2);
    var name = 'mike-exercise-backup-' + C.isoDate(now) + '.json';
    var file = null;
    try { file = new File([json], name, { type: 'application/json' }); } catch (e) { file = null; }
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Exercise progress backup' }).then(markBackedUp).catch(function (err) {
        if (err && err.name === 'AbortError') return;      /* they closed the share sheet */
        download(json, name); markBackedUp();
      });
    } else {
      download(json, name);
      markBackedUp();
    }
  }

  function importData(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast('Could not read that file.'); };
    reader.onload = function () {
      var res = store.parseImport(String(reader.result));
      if (!res.ok) {
        modal({ title: 'Cannot restore', content: el('p', {}, res.error), buttons: [{ label: 'OK', value: true, kind: 'primary' }] });
        return;
      }
      var when = res.exportedAt ? ' It was saved on ' + C.niceDate(res.exportedAt.slice(0, 10)) + '.' : '';
      confirmBox('Restore this backup?', 'This replaces the progress on this iPhone with the progress in the file.' + when, 'Yes, restore', true).then(function (ok) {
        if (!ok) return;
        store.replaceWith(res.data);
        ui.viewDay = null; ui.tips = {};
        render();
        toast('Progress restored.');
      });
    };
    reader.readAsText(file);
  }

  function renderData(main) {
    var last = store.lastBackup();
    main.appendChild(el('h2', {}, 'Your data'));
    main.appendChild(el('div', { class: 'notice' }, D.BACKUP_NOTE));
    main.appendChild(el('p', { class: 'progress-line', id: 'last-backup' }, 'Last backed up: ' + (last ? C.niceDate(last) : 'never')));
    main.appendChild(stopLine());
    var fileInput = el('input', { type: 'file', id: 'import-file', accept: 'application/json,.json', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true',
      onchange: function () { var f = fileInput.files && fileInput.files[0]; importData(f); fileInput.value = ''; } });
    main.appendChild(el('div', { class: 'btn-row' },
      btn('Export progress', { kind: 'primary big', fid: 'export', onclick: exportData }),
      btn('Import from file', { kind: 'navy', fid: 'import', onclick: function () { fileInput.click(); } }),
      fileInput,
      btn('Reset all', { kind: 'danger', fid: 'reset', onclick: function () {
        confirmBox('Erase everything?', 'This deletes all your ticks, tracker, notes and settings on this iPhone. It cannot be undone. Tip: export a backup first.', 'Yes, erase everything', true).then(function (ok) {
          if (!ok) return;
          store.resetAll(); ui.viewDay = null; ui.tips = {};
          location.hash = '#today'; render();
          toast('Everything was reset.');
        });
      } })));
    var soundBtn = btn('', { fid: 'sound-toggle', onclick: function () {
      store.data.prefs.mute = !store.data.prefs.mute; save();
      soundBtn.textContent = store.data.prefs.mute ? 'Sound is OFF - tap to turn on' : 'Sound is ON - tap to turn off';
      showSoundStatus();
      toast(store.data.prefs.mute ? 'Sound is now OFF. Timers will be silent.' : 'Sound is now ON.');
    } });
    soundBtn.textContent = store.data.prefs.mute ? 'Sound is OFF - tap to turn on' : 'Sound is ON - tap to turn off';
    var soundCard = card('Sound check', 'Timers beep for the last 3 seconds and chime at the end. Tap the button and you should hear a beep, then a chime. If you hear nothing, turn up the volume with the side buttons while this page is open, and check the ring/silent switch.');
    soundCard.appendChild(el('div', { class: 'btn-row' },
      btn('Test sound', { kind: 'navy', fid: 'sound-test', onclick: function () {
        unlockAudio();
        if (store.data.prefs.mute) { toast('Sound is OFF, so nothing will play. Tap the sound button below to turn it on.'); showSoundStatus(); return; }
        whenAudioReady(function () { tone(880, 0, 0.16, 0.7); tone(660, 0.6, 0.3, 0.8); tone(880, 0.88, 0.3, 0.8); tone(1320, 1.16, 0.8, 0.8); });
        showSoundStatus();
      } }), soundBtn));
    soundCard.appendChild(el('p', { class: 'hint', id: 'sound-status' }, soundStatusText()));
    main.appendChild(soundCard);
    main.appendChild(el('p', { class: 'hint' }, 'Tip: after you add this app to your Home Screen, always open it from the Home Screen icon so your progress stays in one place.'));
  }

  /* ================= GUIDED / TIMER SCREEN ================= */

  var G = { runner: null, block: null, timer: null, key: '', refs: {}, opener: null };

  function startGuided(block, openerFid) {
    unlockAudio();
    if (G.runner) return;
    G.block = block;
    G.opener = openerFid || null;
    G.key = '';
    G.runner = C.createRunner(block.steps, { beep: beep, chime: chime }, Date.now());
    G.timer = setInterval(tickG, 250);
    var app = $('app');
    app.setAttribute('aria-hidden', 'true');
    if ('inert' in app) app.inert = true;
    requestWake();
    renderGuided();
  }

  function endGuided() {
    clearInterval(G.timer);
    G.timer = null; G.runner = null; G.block = null; G.key = '';
    releaseWake();
    $('guided-root').textContent = '';
    var app = $('app');
    app.removeAttribute('aria-hidden');
    if ('inert' in app) app.inert = false;
    var opener = G.opener;
    render();
    if (opener) { var t = document.querySelector('[data-fid="' + opener + '"]'); if (t) t.focus(); }
  }

  function tickG() {
    if (!G.runner) return;
    G.runner.tick(Date.now());
    renderGuided();
  }

  function stopGuided() {
    var r = G.runner;
    var wasPaused = r.paused;
    r.pause(Date.now());
    confirmBox('Stop this session?', 'Nothing will be ticked on your checklist.', 'Yes, stop', true).then(function (ok) {
      if (!G.runner) return;
      if (ok) { r.stop(); endGuided(); } else if (!wasPaused) { r.resume(Date.now()); renderGuided(); }
    });
  }

  function guidedText(v) {
    var s = v.step;
    if (v.finished) return 'Finished';
    if (v.phase === 'timesup') return "Time's up";
    if (v.phase === 'switch') return 'Switch sides';
    return 'Step ' + (v.idx + 1) + ' of ' + v.total + ': ' + s.name;
  }

  function renderGuided() {
    var r = G.runner;
    if (!r) return;
    var now = Date.now();
    var v = r.view(now);
    var root = $('guided-root');
    var key = [v.idx, v.phase, v.side, v.paused ? 1 : 0, v.finished ? 1 : 0].join('|');
    if (key !== G.key || !root.firstChild) {
      var focusId = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-fid') : null;
      G.key = key;
      buildGuided(root, v);
      announce(guidedText(v));
      var target = focusId && root.querySelector('[data-fid="' + focusId + '"]');
      if (!target) target = root.querySelector('.g-main-btn') || root.querySelector('[data-fid="g-stop"]') || root.querySelector('.btn');
      if (target) target.focus();
    }
    updateGuided(v);
  }

  function buildGuided(root, v) {
    var s = v.step;
    var block = G.block;
    var refs = G.refs = {};
    var single = v.total === 1;
    var cls = 'guided' + (v.finished ? ' done' : v.phase === 'timesup' ? ' timesup' : v.phase === 'switch' ? ' switch' : '');
    var screen = el('div', { class: cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': block.title });

    refs.mute = el('button', { type: 'button', class: 'mute', 'data-fid': 'g-mute', onclick: function () {
      store.data.prefs.mute = !store.data.prefs.mute; save(); refs.mute.textContent = muteLabel(); refs.mute.setAttribute('aria-label', muteName());
      if (!store.data.prefs.mute) { unlockAudio(); beep(); }
    }, 'aria-label': muteName() }, muteLabel());
    screen.appendChild(el('div', { class: 'g-top' }, el('div', { class: 'g-title' }, block.title),
      el('div', { class: 'right' }, refs.mute, el('button', { type: 'button', class: 'safety-btn', 'data-fid': 'g-safety', onclick: showSafety }, '⚠ Safety'))));

    var body = el('div', { class: 'g-body' });
    screen.appendChild(body);
    var controls = [];
    var stop = { label: 'Stop', fid: 'g-stop', fn: stopGuided };

    function c(label, fid, fn) { return { label: label, fid: fid, fn: fn }; }
    function nextText() { return v.next ? 'Next up: ' + v.next : 'This is the last step.'; }

    if (v.finished) {
      var ids = C.idsToTick(block, r().completed);
      body.appendChild(el('p', { class: 'g-big' }, 'Well done!'));
      body.appendChild(el('p', { class: 'g-coach' }, 'You finished ' + block.title + '.'));
      if (ids.length) {
        body.appendChild(el('p', { class: 'g-coach' }, 'Tick ' + (ids.length === 1 ? 'this item' : 'these ' + ids.length + ' items') + ' on your checklist?'));
        body.appendChild(el('button', { type: 'button', class: 'btn g-main-btn', 'data-fid': 'g-tick', onclick: function () {
          var st = dayState(block.iso);
          ids.forEach(function (id) { st.checks[id] = true; });
          save(); endGuided(); toast('Ticked on your checklist.');
        } }, 'Yes, tick them'));
        controls = [c('No, leave unticked', 'g-leave', function () { endGuided(); })];
      } else {
        body.appendChild(el('p', { class: 'g-coach' }, block.tickIds && block.tickIds.length || block.steps.some(function (x) { return x.tickId; })
          ? 'Some steps were skipped, so nothing was ticked. You can tick things yourself on the checklist.' : ''));
        controls = [c('Close', 'g-close', function () { endGuided(); })];
      }
    } else {
      if (!single) {
        body.appendChild(el('p', { class: 'g-count' }, 'Step ' + (v.idx + 1) + ' of ' + v.total));
        refs.bar = el('i', {});
        body.appendChild(el('div', { class: 'g-bar', 'aria-hidden': 'true' }, refs.bar));
        refs.bar.style.width = Math.round(100 * v.idx / v.total) + '%';
      }
      if (v.phase === 'timesup') {
        body.appendChild(el('p', { class: 'g-big' }, "Time's up!"));
        body.appendChild(el('p', { class: 'g-name' }, s.name));
        body.appendChild(el('p', { class: 'g-next' }, nextText()));
        controls = single ? [stop] : [c('Back', 'g-back', function () { r().back(Date.now()); renderGuided(); }),
          c('Skip', 'g-skip', function () { r().skip(Date.now()); renderGuided(); }), stop];
      } else if (v.phase === 'switch') {
        body.appendChild(el('p', { class: 'g-big' }, 'Switch sides'));
        body.appendChild(el('p', { class: 'g-name' }, s.name));
        body.appendChild(el('p', { class: 'g-coach' }, 'Now do the left side.'));
        body.appendChild(el('button', { type: 'button', class: 'btn g-main-btn', 'data-fid': 'g-side2', onclick: function () {
          r().startSecondSide(Date.now()); renderGuided();
        } }, 'Start left side'));
        controls = [c('Back', 'g-back', function () { r().back(Date.now()); renderGuided(); }),
          c('Skip', 'g-skip', function () { r().skip(Date.now()); renderGuided(); }), stop];
      } else if (v.phase === 'intro') {
        body.appendChild(el('p', { class: 'g-name' }, 'Set-up'));
        body.appendChild(el('ul', { class: 'g-list' }, s.items.map(function (i) { return el('li', {}, i); })));
        body.appendChild(el('button', { type: 'button', class: 'btn g-main-btn', 'data-fid': 'g-ready', onclick: function () {
          r().done(Date.now()); renderGuided();
        } }, "I'm ready"));
        controls = [stop];
      } else if (v.phase === 'reps') {
        body.appendChild(el('p', { class: 'g-name' }, s.name));
        body.appendChild(el('p', { class: 'g-reps' }, s.label));
        body.appendChild(el('p', { class: 'g-coach' }, s.coach));
        if (s.tip && s.tip !== s.coach) body.appendChild(el('p', { class: 'g-tip' }, s.tip));
        body.appendChild(el('button', { type: 'button', class: 'btn g-main-btn', 'data-fid': 'g-done', onclick: function () {
          r().done(Date.now()); renderGuided();
        } }, 'Done'));
        body.appendChild(el('p', { class: 'g-next' }, nextText()));
        controls = single ? [stop] : [c('Back', 'g-back', function () { r().back(Date.now()); renderGuided(); }),
          c('Skip', 'g-skip', function () { r().skip(Date.now()); renderGuided(); }), stop];
      } else {
        /* run: timed, sides, breath, stopwatch */
        body.appendChild(el('p', { class: 'g-name' }, s.name));
        if (s.type === 'sides') body.appendChild(el('p', { class: 'g-side' }, 'Side ' + (v.side + 1) + ' of 2: ' + (v.side === 0 ? 'right side' : 'left side')));
        if (v.paused) body.appendChild(el('span', { class: 'paused-tag' }, 'Paused'));
        if (s.type === 'breath') {
          refs.circle = el('div', { class: 'breath-circle' });
          refs.circleText = el('span', {});
          refs.circle.appendChild(refs.circleText);
          body.appendChild(el('div', { class: 'breath-wrap', 'aria-hidden': 'true' }, refs.circle));
          refs.breathWord = el('p', { class: 'g-reps' });
          refs.breathCount = el('p', { class: 'g-count' });
          body.appendChild(refs.breathWord);
          body.appendChild(refs.breathCount);
        } else {
          refs.clock = el('div', { class: 'g-clock', 'aria-hidden': 'true' });
          body.appendChild(refs.clock);
        }
        if (s.goal) body.appendChild(el('p', { class: 'g-tip' }, s.goal));
        if (s.coach) body.appendChild(el('p', { class: 'g-coach' }, s.coach));
        if (s.tip && s.tip !== s.coach) body.appendChild(el('p', { class: 'g-tip' }, s.tip));
        if (s.type === 'stopwatch') {
          body.appendChild(el('button', { type: 'button', class: 'btn g-main-btn', 'data-fid': 'g-finish', onclick: function () {
            r().done(Date.now()); renderGuided();
          } }, 'Finish'));
        }
        if (!single) body.appendChild(el('p', { class: 'g-next' }, nextText()));
        var pauseC = c(v.paused ? 'Resume' : 'Pause', 'g-pause', function () { r().togglePause(Date.now()); renderGuided(); });
        controls = single || s.type === 'stopwatch'
          ? [pauseC, stop]
          : [pauseC, c('Back', 'g-back', function () { r().back(Date.now()); renderGuided(); }),
            c('Skip', 'g-skip', function () { r().skip(Date.now()); renderGuided(); }), stop];
      }
    }

    screen.appendChild(el('div', { class: 'g-controls c' + controls.length }, controls.map(function (k) {
      return el('button', { type: 'button', class: 'btn', 'data-fid': k.fid, onclick: k.fn }, k.label);
    })));
    var foot = el('div', { class: 'g-foot' });
    if (!v.finished) {
      foot.appendChild(el('p', { class: 'stopline' }, D.STOP_LINE));
      if (block.note) foot.appendChild(el('p', { class: 'g-note' }, block.note));
      refs.wake = el('p', { class: 'g-note' }, D.WAKE_NOTE);
      foot.appendChild(refs.wake);
    }
    screen.appendChild(foot);

    root.textContent = '';
    root.appendChild(screen);
  }

  function r() { return G.runner; }

  function muteLabel() { return store.data.prefs.mute ? '🔇 Off' : '🔊 On'; }
  function muteName() { return store.data.prefs.mute ? 'Sound is off. Tap to turn on.' : 'Sound is on. Tap to turn off.'; }

  function updateGuided(v) {
    var refs = G.refs;
    if (v.finished) {
      /* rest and other timers with nothing to tick just close by themselves */
      var b = G.block;
      var hasTicks = b.steps.some(function (x) { return x.tickId; }) || (b.tickIds && b.tickIds.length);
      if (!hasTicks) endGuided();
      return;
    }
    if (refs.wake) refs.wake.hidden = wake.state === 'ok';
    if (refs.bar && v.total > 1) {
      var frac = v.idx / v.total;
      var dur = v.remainingMs !== null && v.phase === 'run' && v.step.type !== 'breath' ? v.step.seconds * 1000 : null;
      if (dur) frac += (1 - v.remainingMs / dur) / v.total;
      refs.bar.style.width = Math.round(100 * frac) + '%';
    }
    if (v.phase !== 'run') return;
    var s = v.step;
    if (refs.clock) {
      refs.clock.textContent = s.type === 'stopwatch' ? C.formatClock(v.elapsedMs / 1000) : C.formatClock(v.remainingSec);
    }
    if (refs.circle && v.breath) {
      refs.circle.style.transform = 'scale(' + v.breath.scale.toFixed(3) + ')';
      refs.circleText.textContent = v.breath.left;
      refs.breathWord.textContent = v.breath.dir === 'in' ? 'Breathe in…' : 'Breathe out…';
      refs.breathCount.textContent = 'Breath ' + v.breath.n + ' of ' + v.breath.of;
    }
  }

  /* When the phone wakes up or Safari comes back to the front */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (G.runner) { tickG(); requestWake(); }
    else if (ui.viewDate && ui.viewDate !== todayISO() && C.isISO(ui.viewDate)) render();
  });

  /* ================= routing and drawing ================= */

  function currentTab() {
    var h = location.hash.replace('#', '');
    return TABS.indexOf(h) >= 0 ? h : 'today';
  }

  function render() {
    var active = document.activeElement;
    var fid = active && active.getAttribute ? active.getAttribute('data-fid') : null;
    var scrollY = window.scrollY;
    var main = $('main');
    var tab = currentTab();
    renderBanners();
    main.textContent = '';
    var agreed = store.data.consent.agreed;
    $('tabs').hidden = !agreed;
    if (!agreed) renderDisclaimer(main);
    else if (tab === 'today') renderToday(main);
    else if (tab === 'tracker') renderTracker(main);
    else if (tab === 'checkin') renderCheckin(main);
    else renderData(main);
    Array.prototype.forEach.call(document.querySelectorAll('#tabs a'), function (a) {
      if (a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, scrollY);
    if (fid && !G.runner) {
      var again = document.querySelector('#main [data-fid="' + fid + '"]');
      if (again) { try { again.focus({ preventScroll: true }); } catch (e) { again.focus(); } }
    }
  }

  window.addEventListener('hashchange', function () {
    render();
    window.scrollTo(0, 0);
    $('main').focus({ preventScroll: true });
  });

  $('safety-btn').addEventListener('click', showSafety);

  /* Offline support, limited to this folder */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () { /* offline support is optional */ });
    });
  }

  /* A small handle so the automated tests can look inside */
  window.mikeExerciseApp = { store: store, core: C, data: D, render: render, startGuided: startGuided, ui: ui };

  render();
})();
