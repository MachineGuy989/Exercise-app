/*
 * core.js - the "brains": dates, week progression, Tai Chi scaling,
 * saved data (localStorage) and the timer engine. No screen code here.
 */
(function (root) {
  'use strict';

  var D = root.EXERCISE_DATA;
  var C = {};

  /* ---------- dates (always the device's local date) ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  C.isoDate = function (d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  C.parseISO = function (s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  };
  /* Monday = 0 ... Sunday = 6 */
  C.dayIndex = function (d) { return (d.getDay() + 6) % 7; };
  C.isISO = function (s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); };
  C.daysBetween = function (a, b) {
    var pa = a.split('-'), pb = b.split('-');
    return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
  };
  C.addDays = function (iso, n) {
    var d = C.parseISO(iso);
    d.setDate(d.getDate() + n);
    return C.isoDate(d);
  };
  /* The seven ISO dates (Monday..Sunday) of the calendar week containing todayISO */
  C.weekDates = function (todayISO) {
    var monday = C.addDays(todayISO, -C.dayIndex(C.parseISO(todayISO)));
    var out = [];
    for (var i = 0; i < 7; i++) out.push(C.addDays(monday, i));
    return out;
  };
  C.niceDate = function (iso) {
    if (!C.isISO(iso)) return '';
    var d = C.parseISO(iso);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return D.DAYS[C.dayIndex(d)].short + ' ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  };
  C.formatClock = function (totalSeconds) {
    totalSeconds = Math.max(0, Math.floor(totalSeconds));
    var m = Math.floor(totalSeconds / 60), s = totalSeconds % 60;
    return m + ':' + pad(s);
  };

  /* ---------- progression ---------- */

  C.progressionFor = function (week) {
    week = Math.min(8, Math.max(1, week | 0));
    for (var i = 0; i < D.PROGRESSION.length; i++) {
      var p = D.PROGRESSION[i];
      if (week >= p.from && week <= p.to) return p;
    }
    return D.PROGRESSION[D.PROGRESSION.length - 1];
  };

  /* ---------- Chair Tai Chi scaling ---------- */

  function baseById(id) {
    for (var i = 0; i < D.TAICHI.base.length; i++) if (D.TAICHI.base[i].id === id) return D.TAICHI.base[i];
    return null;
  }

  /* Scale the base 15-minute flow to `minutes`, in 15-second steps, so the total is exact. */
  C.scaleTaiChi = function (minutes) {
    var base = D.TAICHI.base;
    var baseTotal = 0, i;
    for (i = 0; i < base.length; i++) baseTotal += base[i].minutes;
    var totalUnits = Math.round(minutes * 4);             /* 15-second units */
    var units = [], fracs = [], used = 0;
    for (i = 0; i < base.length; i++) {
      var exact = base[i].minutes * totalUnits / baseTotal;
      var fl = Math.floor(exact + 1e-9);
      units.push(fl);
      fracs.push({ i: i, f: exact - fl });
      used += fl;
    }
    fracs.sort(function (a, b) { return (b.f - a.f) || (a.i - b.i); });
    for (var r = 0; r < totalUnits - used; r++) units[fracs[r % fracs.length].i] += 1;
    return base.map(function (b, k) {
      return { id: b.id, name: b.name, seconds: units[k] * 15, cue: b.cue };
    });
  };

  C.taiChiFinish5 = function () {
    return D.TAICHI.finish5.map(function (f) {
      var b = baseById(f.ref);
      return { id: b.id, name: b.name, seconds: f.minutes * 60, cue: b.cue };
    });
  };

  /* ---------- guided blocks (lists of steps for the timer screen) ---------- */

  function copy(o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }

  /* A "block" = { title, steps, tickIds, tickRule } ; tickRule 'each' ticks a step's tickId when that
     step is completed, 'all' ticks every id only if every step was completed. */

  C.warmupBlock = function (iso) {
    var steps = D.WARMUP.steps.map(function (s) { var c = copy(s); c.tickId = 'warmup.' + s.id; return c; });
    return { title: D.WARMUP.title, iso: iso, steps: steps, tickRule: 'each', note: D.SUPPORT_NOTE };
  };

  C.cooldownBlock = function (iso) {
    var steps = D.COOLDOWN.steps.map(function (s) { var c = copy(s); c.tickId = 'cool.' + s.id; return c; });
    return { title: D.COOLDOWN.title, iso: iso, steps: steps, tickRule: 'each', note: D.STRETCH_NOTE };
  };

  C.stretchBlock = function (iso, holdSeconds) {
    var steps = D.STRETCHES.map(function (s) {
      return { id: s.id, name: s.name, type: s.sides ? 'sides' : 'timed', seconds: holdSeconds,
        label: holdSeconds + ' seconds' + (s.sides ? ' each side' : ''), coach: s.coach, tickId: 'stretch.' + s.id };
    });
    return { title: 'Stretches', iso: iso, steps: steps, tickRule: 'each', note: D.STRETCH_NOTE };
  };

  C.taiChiBlock = function (iso, opts) {
    /* opts: { minutes } scaled flow, or { finish5:true } ; tickId */
    var segs = opts.finish5 ? C.taiChiFinish5() : C.scaleTaiChi(opts.minutes);
    var steps = [{ id: 'setup', name: 'Set-up', type: 'intro', items: D.TAICHI.setup }];
    segs.forEach(function (s) {
      steps.push({ id: s.id, name: s.name, type: 'timed', seconds: s.seconds, coach: s.cue,
        label: C.formatClock(s.seconds) });
    });
    return { title: opts.title || 'Chair Tai Chi', iso: iso, steps: steps, tickIds: [opts.tickId],
      tickRule: 'all', note: D.TAICHI_FEEL };
  };

  C.timerBlock = function (iso, o) {
    /* single timer: { title, name, type:'timed'|'stopwatch', seconds, coach, tickId? } */
    var step = { id: 'timer', name: o.name, type: o.type || 'timed', seconds: o.seconds, coach: o.coach || '',
      tip: o.tip || '', goal: o.goal || '' };
    return { title: o.title, iso: iso, steps: [step], tickIds: o.tickId ? [o.tickId] : [], tickRule: 'all',
      note: o.note || '' };
  };

  /* Which checklist ids should be ticked, given the steps the runner completed? */
  C.idsToTick = function (block, completedMap) {
    var out = [], i, s;
    if (block.tickRule === 'each') {
      for (i = 0; i < block.steps.length; i++) {
        s = block.steps[i];
        if (s.tickId && completedMap[i]) out.push(s.tickId);
      }
    } else {
      var all = true;
      for (i = 0; i < block.steps.length; i++) {
        if (block.steps[i].type === 'intro') continue;
        if (!completedMap[i]) all = false;
      }
      if (all) out = (block.tickIds || []).slice();
    }
    return out;
  };

  /* ---------- the timer engine ---------- */
  /* Every time is worked out from timestamps passed in (Date.now()), never by counting ticks,
     so it stays correct if the screen locks or Safari is in the background. */

  var TIMESUP_MS = 2000;

  function Runner(steps, hooks) {
    this.steps = steps;
    this.hooks = hooks || {};
    this.completed = {};
    this.finished = false;
    this.stopped = false;
    this.idx = 0;
    this._enter(0, 0);
  }

  Runner.prototype._call = function (name, arg) {
    if (this.hooks[name]) { try { this.hooks[name](arg); } catch (e) { /* sound problems must never stop the timer */ } }
  };

  Runner.prototype._enter = function (i, now) {
    this.idx = i;
    var s = this.steps[i];
    this.side = 0;
    this.paused = false;
    this.accum = 0;
    this.startedAt = now;
    this.lastBeep = null;
    if (s.type === 'intro') this.phase = 'intro';
    else if (s.type === 'reps') this.phase = 'reps';
    else this.phase = 'run';
  };

  Runner.prototype.start = function (now) { this._enter(0, now); };

  Runner.prototype._restartClock = function (phase, now) {
    this.phase = phase; this.accum = 0; this.startedAt = now; this.lastBeep = null; this.paused = false;
  };

  Runner.prototype.elapsed = function (now) {
    return this.accum + (this.paused ? 0 : Math.max(0, now - this.startedAt));
  };

  Runner.prototype._duration = function () {
    var s = this.steps[this.idx];
    if (this.phase === 'timesup') return TIMESUP_MS;
    if (this.phase !== 'run') return null;
    if (s.type === 'timed' || s.type === 'sides') return s.seconds * 1000;
    if (s.type === 'breath') return s.breaths * (s.inSec + s.outSec) * 1000;
    return null;                                            /* stopwatch: no end */
  };

  Runner.prototype._next = function (now) {
    if (this.idx + 1 >= this.steps.length) {
      this.finished = true;
      this._call('finish');
    } else {
      this._enter(this.idx + 1, now);
    }
  };

  Runner.prototype.tick = function (now) {
    if (this.finished || this.stopped || this.paused) return;
    var dur = this._duration();
    if (dur == null) return;
    var el = this.elapsed(now);
    if (el >= dur) {
      if (this.phase === 'run') {
        this._call('chime');
        this._restartClock('timesup', now);
      } else if (this.phase === 'timesup') {
        var s = this.steps[this.idx];
        if (s.type === 'sides' && this.side === 0) {
          this._restartClock('switch', now);
          this.side = 1;
        } else {
          this.completed[this.idx] = true;
          this._next(now);
        }
      }
      return;
    }
    if (this.phase === 'run') {
      var st = this.steps[this.idx];
      if (st.type === 'timed' || st.type === 'sides') {
        var rem = Math.ceil((dur - el) / 1000);
        if (rem >= 1 && rem <= 3 && rem !== this.lastBeep) {
          this.lastBeep = rem;
          this._call('beep', rem);
        }
      }
    }
  };

  Runner.prototype.pause = function (now) {
    if (this.paused || this.finished) return;
    this.accum = this.elapsed(now);
    this.paused = true;
  };
  Runner.prototype.resume = function (now) {
    if (!this.paused) return;
    this.paused = false;
    this.startedAt = now;
  };
  Runner.prototype.togglePause = function (now) { if (this.paused) this.resume(now); else this.pause(now); };

  /* "Done" for a reps step, the set-up screen, or the stopwatch */
  Runner.prototype.done = function (now) {
    if (this.finished) return;
    var s = this.steps[this.idx];
    if (this.phase === 'reps' || (this.phase === 'run' && s.type === 'stopwatch')) {
      this.completed[this.idx] = true;
      if (s.type === 'stopwatch') this._call('chime');
      this._next(now);
    } else if (this.phase === 'intro') {
      this._next(now);
    }
  };

  /* After "Switch sides" */
  Runner.prototype.startSecondSide = function (now) {
    if (this.phase === 'switch') this._restartClock('run', now);
  };

  Runner.prototype.skip = function (now) {
    if (this.finished) return;
    this._next(now);
  };

  Runner.prototype.back = function (now) {
    if (this.finished) return;
    var restartHere = this.idx === 0 || (this.phase === 'run' && this.side === 0 && this.elapsed(now) > 3000);
    this._enter(restartHere ? this.idx : this.idx - 1, now);
  };

  Runner.prototype.stop = function () { this.stopped = true; };

  /* Everything the screen needs to draw right now */
  Runner.prototype.view = function (now) {
    var s = this.steps[this.idx];
    var v = {
      step: s, idx: this.idx, total: this.steps.length, phase: this.phase, side: this.side,
      paused: this.paused, finished: this.finished,
      next: this.idx + 1 < this.steps.length ? this.steps[this.idx + 1].name : null,
      elapsedMs: 0, remainingMs: null, remainingSec: null
    };
    if (this.finished) return v;
    var el = this.elapsed(now);
    var dur = this._duration();
    v.elapsedMs = el;
    if (dur != null) {
      v.remainingMs = Math.max(0, dur - el);
      v.remainingSec = Math.ceil(v.remainingMs / 1000);
    }
    if (this.phase === 'run' && s.type === 'breath') {
      var cyc = (s.inSec + s.outSec) * 1000;
      var clamped = Math.min(el, s.breaths * cyc - 1);
      var pos = clamped % cyc;
      var inMs = s.inSec * 1000;
      v.breath = { n: Math.min(s.breaths, Math.floor(clamped / cyc) + 1), of: s.breaths };
      if (pos < inMs) {
        v.breath.dir = 'in';
        v.breath.left = Math.ceil((inMs - pos) / 1000);
        v.breath.scale = 0.5 + 0.5 * (pos / inMs);
      } else {
        v.breath.dir = 'out';
        v.breath.left = Math.ceil((cyc - pos) / 1000);
        v.breath.scale = 1 - 0.5 * ((pos - inMs) / (s.outSec * 1000));
      }
    }
    return v;
  };

  C.createRunner = function (steps, hooks, now) {
    var r = new Runner(steps, hooks);
    r.start(now);
    return r;
  };

  /* ---------- saved data ---------- */

  var DATA_KEY = D.STORAGE_PREFIX + 'data';
  var BACKUP_KEY = D.STORAGE_PREFIX + 'lastBackup';
  var FORMAT = 'mikeExercise.backup';

  C.DATA_KEY = DATA_KEY;

  function newTracker() {
    var t = [];
    for (var w = 0; w < 8; w++) t.push({ days: [false, false, false, false, false, false, false], notes: '' });
    return t;
  }

  C.defaults = function (todayISO) {
    var targets = [];
    for (var i = 0; i < D.SUCCESS_TARGETS.length; i++) targets.push({ done: false, date: null });
    return {
      version: 1,
      consent: { agreed: false, date: null },
      currentWeek: 1,
      weekStartDate: todayISO,
      programComplete: false,
      days: {},
      tracker: newTracker(),
      readyChecks: [false, false, false, false],
      targets: targets,
      prefs: {
        tueTaiChi: 15, stretchHold: D.STRETCH_HOLD_DEFAULT, walkMinutes: D.WALK.defaultMinutes,
        wedTaiChi: 0, sunMinutes: D.RECOVERY.defaultMinutes, restSeconds: 30, mute: false
      }
    };
  };

  function bool(v) { return v === true; }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function pick(v, allowed, dflt) { return allowed.indexOf(v) >= 0 ? v : dflt; }

  /* Turn anything (an old save, an imported file) into a safe, complete data object. */
  C.normalize = function (raw, todayISO) {
    var d = C.defaults(todayISO);
    if (!raw || typeof raw !== 'object') return d;
    var i, k;
    if (raw.consent && typeof raw.consent === 'object') {
      d.consent.agreed = bool(raw.consent.agreed);
      d.consent.date = C.isISO(raw.consent.date) ? raw.consent.date : null;
    }
    var w = parseInt(raw.currentWeek, 10);
    d.currentWeek = (w >= 1 && w <= 8) ? w : 1;
    d.weekStartDate = C.isISO(raw.weekStartDate) ? raw.weekStartDate : todayISO;
    d.programComplete = bool(raw.programComplete) && d.currentWeek === 8;
    if (raw.days && typeof raw.days === 'object') {
      for (k in raw.days) {
        if (!C.isISO(k) || !raw.days[k] || typeof raw.days[k] !== 'object') continue;
        var rd = raw.days[k], nd = { checks: {}, adventure: '', adventureOther: '' };
        if (rd.checks && typeof rd.checks === 'object') {
          for (var c in rd.checks) if (rd.checks[c] === true && /^[\w.\-]{1,60}$/.test(c)) nd.checks[c] = true;
        }
        nd.adventure = pick(rd.adventure, D.ADVENTURES, '');
        nd.adventureOther = str(rd.adventureOther, 80);
        d.days[k] = nd;
      }
    }
    if (Array.isArray(raw.tracker)) {
      for (i = 0; i < 8; i++) {
        var rt = raw.tracker[i];
        if (!rt || typeof rt !== 'object') continue;
        for (var j = 0; j < 7; j++) d.tracker[i].days[j] = !!(rt.days && rt.days[j] === true);
        d.tracker[i].notes = str(rt.notes, 5000);
      }
    }
    if (Array.isArray(raw.readyChecks)) for (i = 0; i < 4; i++) d.readyChecks[i] = raw.readyChecks[i] === true;
    if (Array.isArray(raw.targets)) {
      for (i = 0; i < d.targets.length; i++) {
        var rg = raw.targets[i];
        if (rg && rg.done === true) {
          d.targets[i].done = true;
          d.targets[i].date = C.isISO(rg.date) ? rg.date : null;
        }
      }
    }
    var p = raw.prefs && typeof raw.prefs === 'object' ? raw.prefs : {};
    d.prefs.tueTaiChi = pick(p.tueTaiChi, D.TUESDAY_TAICHI_CHOICES, 15);
    d.prefs.stretchHold = pick(p.stretchHold, D.STRETCH_HOLDS, D.STRETCH_HOLD_DEFAULT);
    var walkChoices = [];
    for (var m = D.WALK.min; m <= D.WALK.max; m += D.WALK.step) walkChoices.push(m);
    d.prefs.walkMinutes = pick(p.walkMinutes, walkChoices, D.WALK.defaultMinutes);
    d.prefs.wedTaiChi = pick(p.wedTaiChi, D.WED_TAICHI_CHOICES, 0);
    d.prefs.sunMinutes = pick(p.sunMinutes, D.RECOVERY.timerChoices, D.RECOVERY.defaultMinutes);
    d.prefs.restSeconds = pick(p.restSeconds, D.REST_CHOICES, 30);
    d.prefs.mute = bool(p.mute);
    return d;
  };

  function makeBackend(provided) {
    var mem = {};
    var memory = {
      ok: false,
      get: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      set: function (k, v) { mem[k] = String(v); },
      remove: function (k) { delete mem[k]; },
      keys: function () { return Object.keys(mem); }
    };
    try {
      var ls = provided || root.localStorage;
      var probe = D.STORAGE_PREFIX + '__probe';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return {
        ok: true,
        get: function (k) { return ls.getItem(k); },
        set: function (k, v) { ls.setItem(k, v); },
        remove: function (k) { ls.removeItem(k); },
        keys: function () { var o = []; for (var i = 0; i < ls.length; i++) o.push(ls.key(i)); return o; }
      };
    } catch (e) {
      return memory;
    }
  }

  C.createStore = function (todayISOFn, provided) {
    var backend = makeBackend(provided);
    var store = { ok: backend.ok, saveFailed: false, data: null };

    store.load = function () {
      var raw = null;
      try {
        var text = backend.get(DATA_KEY);
        if (text) raw = JSON.parse(text);
      } catch (e) { raw = null; }
      store.data = C.normalize(raw, todayISOFn());
      return store.data;
    };
    store.save = function () {
      try { backend.set(DATA_KEY, JSON.stringify(store.data)); store.saveFailed = false; }
      catch (e) { store.saveFailed = true; }
      return !store.saveFailed;
    };
    store.lastBackup = function () {
      try { var v = backend.get(BACKUP_KEY); return C.isISO(v) ? v : null; } catch (e) { return null; }
    };
    store.setLastBackup = function (iso) {
      try { backend.set(BACKUP_KEY, iso); } catch (e) { /* ignore */ }
    };
    store.exportPayload = function (nowISOString) {
      return { app: FORMAT, formatVersion: 1, exportedAt: nowISOString, data: store.data };
    };
    /* Returns { ok:true } or { ok:false, error } ; does not change anything unless ok. */
    store.parseImport = function (text) {
      var obj;
      try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'That file is not a readable backup.' }; }
      if (!obj || obj.app !== FORMAT || !obj.data || typeof obj.data !== 'object') {
        return { ok: false, error: 'That file is not a backup from this app.' };
      }
      return { ok: true, data: C.normalize(obj.data, todayISOFn()), exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '' };
    };
    store.replaceWith = function (data) { store.data = data; return store.save(); };
    store.resetAll = function () {
      var keys = backend.keys(), i;
      for (i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(D.STORAGE_PREFIX) === 0) { try { backend.remove(keys[i]); } catch (e) { /* ignore */ } }
      }
      store.data = C.defaults(todayISOFn());
      store.saveFailed = false;
    };
    store.load();
    return store;
  };

  root.MikeCore = C;
})(window);
