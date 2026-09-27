/* 초록 보카 / 노랭이 보카 core logic (both apps): words, spaced repetition, question generation, lessons and tests.
   No DOM access, so the same file runs in the page and in the node tests. */
const Logic = (() => {
  'use strict';

  const INTERVAL = [0, 1, 3, 7, 16, 35, 80, 180];  // box -> days until the next review
  const MAXBOX = INTERVAL.length - 1;
  const MASTER = 5;                                 // box at which a word counts as mastered
  const DAYMS = 864e5, SHIFT = 4 * 36e5;            // a study day rolls over at 4am local time
  const LESSON_NEW = 5, LESSON_REV = 5, REVIEW_LESSON = 10, DAILY_TEST = 10;   // a lesson: 5 new words + up to 5 reviews, or 10 reviews
  const MIX_TYPES = ['mcq-ko', 'mcq-en', 'syn', 'listen', 'spell', 'cloze', 'ctx', 'dict', 'multi'];
  const AUDIO_TYPES = ['listen', 'dict'];

  const dayNum = (t = Date.now()) => { const d = new Date(t - SHIFT); return Math.floor((d.getTime() - d.getTimezoneOffset() * 6e4) / DAYMS); };
  const dayKey = n => new Date(n * DAYMS).toISOString().slice(0, 10);

  let rand = Math.random;
  function seed(s) {
    rand = function () { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const pick = a => a[Math.floor(rand() * a.length)];
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* ---------- words ---------- */
  const KO_END = /(적으로|스럽게|스러운|시키다|시키는|하다|하게|하는|되다|되는|적인|로운|롭게|된|한|인|의|는|은|게|히|다)$/;
  const KO_STOP = new Set(['않은', '않는', '않게', '있는', '없는', '하는', '되는', '하다', '되다', '이다', '같은', '매우', '아주', '가장', '많은', '것', '등']);
  function stems(ko) {
    const out = new Set();
    for (let t of String(ko).replace(/\([^)]*\)/g, ' ').split(/[\s,;·/~]+/)) {
      t = t.trim();
      if (t.length < 2 || KO_STOP.has(t)) continue;
      const s = t.replace(KO_END, '');
      out.add(s.length >= 2 ? s : t);
    }
    return out;
  }
  function posOf(ko) {
    const first = String(ko).replace(/\([^)]*\)/g, '').split(/[,;]/)[0].trim().replace(/^~\s*/, '');
    if (/다$/.test(first)) return 'v';
    if (/(한|인|는|은|운|의|된|진|난|른|던|있는|없는)$/.test(first)) return 'a';
    if (/(게|히|로|서|도|이|에|여|며|곧|즉시|단지|가끔|모두|자주)$/.test(first)) return 'r';
    return 'n';
  }
  function synonymsOf(senses) {
    const out = [];
    for (const s of senses) {
      for (let x of s.en.replace(/\([^)]*\)/g, ' ').split(/[,;]/)) {
        x = x.replace(/[가-힣]+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (x && !out.includes(x)) out.push(x);
      }
    }
    return out;
  }
  // 풀이 chunks may be stored as word counts over the example ([[2, 2, 3], korean]) -> ["I sent / my resume / ...", korean]
  function unchunk(ch, ex) {
    if (!Array.isArray(ch) || !Array.isArray(ch[0])) return Array.isArray(ch) ? ch : null;
    const ws = String(ex || '').trim().split(/\s+/), out = [];
    let i = 0;
    for (const n of ch[0]) { out.push(ws.slice(i, i + n).join(' ')); i += n; }
    return [out.join(' / '), ch[1]];
  }
  function prepare(rows) {
    const words = rows.map((r, i) => {
      // a sense: similar words, meaning, example, its Korean, and the example's 풀이 (chunks [english, korean] and a tip)
      const senses = r[3].map(s => ({ en: s[0] || '', ko: s[1] || '', ex: s[2] || '', exKo: s[3] || '', ch: unchunk(s[4], s[2]), tip: s[5] || '', ct: Array.isArray(s[6]) ? s[6] : null }));
      const e = { id: r[0] + '-' + r[1], d: r[0], n: r[1], w: r[2], senses, note: r[4] || '', fix: r[5] || '', i };
      const x = r[6] || {};   // beginner card: part of speech, words to speak, words the example uses, chunks, tip, grammar pattern
      e.pk = x.pos || ''; e.say = x.say || ''; e.hit = x.hit || ''; e.pat = !!x.pat; e.ipa = x.ipa || '';
      if (senses[0] && !senses[0].ch && !senses[0].tip) { senses[0].ch = unchunk(x.ch, senses[0].ex); senses[0].tip = x.tip || ''; senses[0].ct = Array.isArray(x.ct) ? x.ct : null; }   // 노랭이 cards keep them per word
      e.key = e.w.toLowerCase();
      e.pos = posOf(senses[0].ko || '');
      e.stems = stems(senses.map(s => s.ko).join(','));
      e.syn = synonymsOf(senses);
      e.synSet = new Set(e.syn);
      return e;
    });
    const byId = new Map(words.map(e => [e.id, e]));
    const days = [...new Set(words.map(e => e.d))].sort((a, b) => a - b);
    const byDay = new Map(days.map(d => [d, words.filter(e => e.d === d)]));
    const byPos = { v: [], a: [], r: [], n: [] };
    for (const e of words) byPos[e.pos].push(e);
    return { words, byId, days, byDay, byPos };
  }

  /* ---------- questions ---------- */
  const overlap = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
  const related = (a, b) => a.key === b.key || overlap(a.stems, b.stems) || overlap(a.synSet, b.synSet) || a.synSet.has(b.key) || b.synSet.has(a.key);
  const shortOpt = s => s.split(' ').length <= 3 && s.length <= 26;
  function tiers(W, target, ok) {
    const near = e => Math.abs(e.d - target.d) <= 3;
    const same = W.byPos[target.pos];
    return [same.filter(e => near(e) && ok(e)), same.filter(ok), W.words.filter(ok)];
  }
  function draw(tierList, n, optionOf, taken) {
    const out = [];
    for (const tier of tierList) {
      for (const e of shuffle(tier.slice())) {
        if (out.length >= n) return out;
        const o = optionOf(e);
        if (o == null || taken.has(o)) continue;
        taken.add(o);
        out.push(o);
      }
    }
    return out;
  }
  function senseIndex(e) {
    const withKo = e.senses.map((s, i) => (s.ko ? i : -1)).filter(i => i >= 0);
    return withKo.length ? pick(withKo) : 0;
  }
  const firstKo = e => { const s = e.senses.find(s => s.ko); return s ? s.ko : null; };
  function finish(q, correct, opts) {
    if (opts.length < 4) return null;
    shuffle(opts);
    q.opts = opts;
    q.a = opts.indexOf(correct);
    return q;
  }
  function qMeaning(W, e, t) {
    const si = senseIndex(e), correct = e.senses[si].ko;
    if (!correct) return null;
    const ds = draw(tiers(W, e, c => !related(c, e)), 3, firstKo, new Set([correct]));
    return finish({ t, id: e.id, si }, correct, [correct, ...ds]);
  }
  function qWord(W, e) {
    const si = senseIndex(e);
    if (!e.senses[si].ko) return null;
    const ds = draw(tiers(W, e, c => !related(c, e)), 3, c => c.w, new Set([e.w]));
    return finish({ t: 'mcq-en', id: e.id, si }, e.w, [e.w, ...ds]);
  }
  // a sense's example split around the headword: [before, the word as written, after]
  function splitEx(e, si) {
    const ex = e.senses[si] && e.senses[si].ex;
    if (!ex) return null;
    const m = new RegExp('(^|[^A-Za-z-])(' + (e.hit || e.w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![A-Za-z-])', 'i').exec(ex);
    if (!m) return null;
    const at = m.index + m[1].length;
    return [ex.slice(0, at), ex.slice(at, at + m[2].length), ex.slice(at + m[2].length)];
  }
  function exSense(e) {
    const ok = e.senses.map((s, i) => (splitEx(e, i) ? i : -1)).filter(i => i >= 0);
    return ok.length ? pick(ok) : -1;
  }
  function qCloze(W, e, typed) {   // fill the blank in the example sentence
    if (e.pat) return null;   // a pattern ("be eligible to do") does not appear word for word in its sentence
    const si = exSense(e);
    if (si < 0) return null;
    const parts = splitEx(e, si);
    if (typed) return { t: 'clozet', id: e.id, si, parts };
    const low = e.senses[si].ex.toLowerCase(), size = e.w.split(' ').length;
    const free = c => !related(c, e) && !low.includes(c.key);
    const ds = draw(tiers(W, e, c => free(c) && c.w.split(' ').length === size).concat([W.words.filter(free)]), 3, c => c.w, new Set([e.w]));
    return finish({ t: 'cloze', id: e.id, si, parts }, e.w, [e.w, ...ds]);
  }
  function qContext(W, e) {   // TOEFL style: the word in the sentence is closest in meaning to
    const si = exSense(e);
    if (si < 0) return null;
    const low = e.senses[si].ex.toLowerCase();
    const pool = synonymsOf([e.senses[si]]).filter(s => s !== e.key && shortOpt(s) && !low.includes(s));
    if (!pool.length) return null;
    const correct = pick(pool.slice(0, 4));
    const taken = new Set([e.key, ...e.syn]);
    const ds = draw(tiers(W, e, c => !related(c, e)), 3, c => {
      const cand = c.syn.filter(s => !taken.has(s) && s !== c.key && shortOpt(s) && !low.includes(s));
      return cand.length ? pick(cand) : null;
    }, taken);
    return finish({ t: 'ctx', id: e.id, si, parts: splitEx(e, si) }, correct, [correct, ...ds]);
  }
  function qSynonym(W, e) {
    const pool = e.syn.filter(s => s !== e.key && shortOpt(s));
    if (!pool.length) return null;
    const correct = pick(pool.slice(0, 4));
    const taken = new Set([e.key, ...e.syn]);
    const ds = draw(tiers(W, e, c => !related(c, e)), 3, c => {
      const cand = c.syn.filter(s => !taken.has(s) && s !== c.key && shortOpt(s));
      return cand.length ? pick(cand) : null;
    }, taken);
    return finish({ t: 'syn', id: e.id }, correct, [correct, ...ds]);
  }
  // every meaning of a word that has several: one per sense (초록), or the items of its one meaning ("공석, 결원, 개장")
  function meaningItems(e) {
    if (e.senses.length > 1) return e.senses.map(s => s.ko).filter(Boolean);
    return String((e.senses[0] && e.senses[0].ko) || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
  }
  const multiOK = e => new Set(meaningItems(e)).size >= 2;
  function qMulti(W, e) {   // pick every meaning: up to 4 of the word's own, the rest (to 6 options) from unrelated words
    const own = shuffle([...new Set(meaningItems(e))]).slice(0, 4);
    if (own.length < 2) return null;
    const perSense = e.senses.length > 1;
    const optionOf = c => {
      const items = perSense ? c.senses.map(s => s.ko).filter(Boolean) : meaningItems(c);
      return items.length ? pick(items) : null;
    };
    const ds = draw(tiers(W, e, c => !related(c, e)), 6 - own.length, optionOf, new Set(meaningItems(e)));
    if (ds.length < 6 - own.length) return null;
    const opts = shuffle([...own, ...ds]);
    return { t: 'multi', id: e.id, si: 0, opts, ans: own.map(o => opts.indexOf(o)).sort((a, b) => a - b) };
  }
  function makeQuestion(W, id, type, hasAudio) {
    const e = W.byId.get(id);
    if (!e) return null;
    if (type === 'listen' && !hasAudio) type = 'mcq-ko';
    if (type === 'dict' && !hasAudio) type = 'spell';
    if (e.pat && ['spell', 'spell1', 'dict', 'clozet', 'cloze'].includes(type)) type = 'mcq-en';   // patterns are not typed
    const order = { 'mcq-ko': ['mcq-ko'], listen: ['listen', 'mcq-ko'], 'mcq-en': ['mcq-en', 'mcq-ko'], syn: ['syn', 'mcq-en', 'mcq-ko'],
      spell: ['spell'], spell1: ['spell1'], dict: ['dict'], cloze: ['cloze', 'mcq-en', 'mcq-ko'], clozet: ['clozet', 'spell1'],
      ctx: ['ctx', 'syn', 'mcq-en', 'mcq-ko'], kotype: ['kotype', 'mcq-ko'], multi: ['multi', 'mcq-ko'], card: ['card'] }[type] || ['mcq-ko'];
    for (const t of order) {
      let q = null;
      if (t === 'mcq-ko' || t === 'listen') q = qMeaning(W, e, t);
      else if (t === 'mcq-en') q = qWord(W, e);
      else if (t === 'syn') q = qSynonym(W, e);
      else if (t === 'spell' || t === 'spell1') q = { t: 'spell', id, si: senseIndex(e), lead: t === 'spell1' ? 1 : 0 };   // lead: letters shown up front
      else if (t === 'dict') q = { t: 'dict', id, si: senseIndex(e) };
      else if (t === 'kotype') q = e.senses[0] && e.senses[0].ko ? { t: 'kotype', id, si: 0 } : null;
      else if (t === 'multi') q = qMulti(W, e);
      else if (t === 'cloze' || t === 'clozet') q = qCloze(W, e, t === 'clozet');
      else if (t === 'ctx') q = qContext(W, e);
      else if (t === 'card') q = { t: 'card', id };
      if (q) return q;
    }
    return { t: 'card', id };
  }
  // writing the Korean meaning: accept any listed meaning, with or without brackets, a 하다-type ending, or the particle
  // that follows ~ ("~에 지원하다" also passes as "지원하다"); anything else goes to the learner's own judgement
  const KO_TAIL = /(시키다|하다|되다|이다|하는|되는|적인|적으로|스러운|스럽게|하게|한|된|히|게|다)$/;
  const koFlat = s => String(s).replace(/[^가-힣a-zA-Z0-9]/g, '');
  function koVariants(ko) {
    const out = new Set();
    const add = v => { if (!v) return; out.add(v); const stem = v.replace(KO_TAIL, ''); if (stem.length >= 2) out.add(stem); };
    for (const item of String(ko).split(/[,;·/]/)) {
      for (const v0 of [item.replace(/\([^)]*\)/g, ' '), item]) {
        const v1 = v0.replace(/\s+/g, ' ').trim();
        add(koFlat(v1));
        if (/^~/.test(v1)) add(koFlat(v1.replace(/^~\s*(을|를|에게|에서|에|의|와|과|으로|로|이|가|은|는)?\s*/, '')));
        if (/\b[AB]\b/.test(v1)) add(koFlat(v1.replace(/\b[AB]\s*(을|를|에게|에서|에|의|와|과|으로|로|이|가|은|는)?\s*/g, '')));   // "A 를 B 로 한정하다" -> 한정하다
      }
    }
    return out;
  }
  function checkKo(e, input) {   // several meanings typed together pass only if each one does
    const vs = koVariants(e.senses.map(s => s.ko).join(','));
    const parts = String(input).split(/[,;·/]/).map(koFlat).filter(Boolean);
    return parts.length > 0 && parts.every(a => { const stem = a.replace(KO_TAIL, ''); return vs.has(a) || (stem.length >= 2 && vs.has(stem)); });
  }
  const normSpell = s => String(s).toLowerCase().replace(/[^a-z]/g, '');
  const checkSpell = (e, input) => normSpell(input).length > 0 && normSpell(input) === normSpell(e.w);

  /* ---------- state ---------- */
  const DEF_EXTRA = {};
  function configure(o) { Object.assign(DEF_EXTRA, o || {}); }   // an app's own defaults (노랭이 reads meanings aloud)
  function defaultSettings() {
    return { daily: 10, goal: 50, start: 1, review: 'quiz', spell: true, sfx: true, say: true, silent: true, koSay: false, repeat: 2, front: 'en', theme: 'system', ...DEF_EXTRA };
  }
  function newState() {
    return { v: 2, prog: {}, stars: {}, wrong: {}, days: {}, tests: [], nt: null, best: 0, xpTotal: 0, settings: defaultSettings(), session: null, spots: {} };
  }
  function sanitize(s, W) {
    const out = Object.assign(newState(), s || {});
    out.settings = Object.assign(defaultSettings(), (s && s.settings) || {});
    const prog = {};
    for (const [k, v] of Object.entries(out.prog || {})) {
      if (Array.isArray(v) && v.length >= 5 && (!W || W.byId.has(k))) prog[k] = v.slice(0, 5).map(Number);
    }
    out.prog = prog;
    for (const key of ['stars', 'wrong', 'days', 'spots', 'seenTypes']) if (!out[key] || typeof out[key] !== 'object' || Array.isArray(out[key])) out[key] = {};
    if (out.today && (typeof out.today.d !== 'number' || out.today.v !== 2 || typeof out.today.rev0 !== 'number')) out.today = null;   // keep today's plan across reloads
    if (!Array.isArray(out.tests)) out.tests = [];
    // a half-done lesson from before short lessons is dropped; its answers are already in prog
    if (out.lesson && out.lesson.v !== 3 && out.lesson.i < (out.lesson.steps || []).length) out.lesson = null;
    return out;
  }
  function fromV1(v1) {   // the first version stored {prog, meta:{daily, front, tts, start, nt, days}}
    const s = newState();
    if (!v1) return s;
    s.prog = v1.prog || {};
    const m = v1.meta || {};
    if (m.daily) s.settings.daily = m.daily;
    if (m.start) s.settings.start = m.start;
    if (m.front) s.settings.front = m.front;
    if (m.nt) s.nt = m.nt;
    for (const [k, d] of Object.entries(m.days || {})) s.days[k] = { xp: 0, n: d.n || 0, r: d.r || 0, ok: d.ok || 0, t: d.t || 0, done: !!d.done, miss: d.miss || [] };
    return s;
  }
  function dayStats(state, T) {
    const k = dayKey(T);
    return state.days[k] || (state.days[k] = { xp: 0, n: 0, r: 0, ok: 0, t: 0, done: false, miss: [] });
  }
  function dayMet(state, k) { const d = state.days[k]; return !!d && !!(d.done || d.met || d.lessons); }   // one lesson keeps the streak
  function addXp(state, ds, xp) {
    ds.xp += xp;
    state.xpTotal = (state.xpTotal || 0) + xp;
    if (ds.xp >= state.settings.goal) ds.met = true;
  }
  function streak(state, T) {
    let t = dayMet(state, dayKey(T)) ? T : T - 1, n = 0;
    while (dayMet(state, dayKey(t))) { n++; t--; }
    return n;
  }
  function touchBest(state, T) { state.best = Math.max(state.best || 0, streak(state, T)); }

  function pickNew(state, W, k, exclude = new Set()) {
    const out = [], start = state.settings.start || 1;
    const order = W.words.filter(e => e.d >= start).concat(W.words.filter(e => e.d < start));
    for (const e of order) {
      if (out.length >= k) break;
      if (!state.prog[e.id] && !exclude.has(e.id)) out.push(e.id);
    }
    return out;
  }
  function ensurePlan(state, W, T) {
    if (!state.nt || state.nt.d !== T) state.nt = { d: T, ids: pickNew(state, W, state.settings.daily) };
    state.nt.ids = state.nt.ids.filter(id => W.byId.has(id));
    return state.nt;
  }
  function refreshPlan(state, W, T) {   // after the daily count or start Day changes
    if (!state.nt || state.nt.d !== T) return;
    const started = state.nt.ids.filter(id => state.prog[id]);
    state.nt.ids = started.concat(pickNew(state, W, Math.max(0, state.settings.daily - started.length), new Set(started)));
  }
  function todayPlan(state, W, T) {
    const planned = state.nt && state.nt.d === T ? state.nt.ids.filter(id => W.byId.has(id)) : pickNew(state, W, state.settings.daily);
    const ntSet = new Set(planned);
    let rev = 0;
    for (const e of W.words) { const p = state.prog[e.id]; if (p && p[1] <= T && !ntSet.has(e.id)) rev++; }
    const newLeft = planned.filter(id => !state.prog[id] || state.prog[id][1] <= T);
    return { T, planned, rev, newLeft: newLeft.length, newIds: newLeft };
  }
  // Today's plan: the new words you chose for the day (5 per lesson, each lesson also clears 5 reviews), then every review
  // still due, done 10 at a time. Nothing is cut or pushed to tomorrow, so the pace is exactly the daily count you picked.
  function dayPlan(state, W, T) {
    if (state.today && state.today.d === T && state.today.v === 2) return state.today;
    ensurePlan(state, W, T);
    const ntSet = new Set(state.nt.ids);
    let R = 0;
    for (const e of W.words) { const p = state.prog[e.id]; if (p && p[1] <= T && !ntSet.has(e.id)) R++; }
    R += state.nt.ids.filter(id => state.prog[id] && state.prog[id][1] <= T).length;
    state.today = { v: 2, d: T, rev0: R };
    return state.today;
  }
  function planStatus(state, W, T) {
    const P = dayPlan(state, W, T), ids = state.nt.ids;
    const freshLeft = ids.filter(id => !state.prog[id]).length;
    const newTotal = Math.ceil(ids.length / LESSON_NEW), newDone = newTotal - Math.ceil(freshLeft / LESSON_NEW);
    const revLeft = todayPlan(state, W, T).rev + ids.filter(id => state.prog[id] && state.prog[id][1] <= T).length;
    const steps = [];
    let f = freshLeft, rv = revLeft;
    for (let i = 0; i < newTotal; i++) {
      if (i < newDone) { steps.push({ kind: 'new', done: true }); continue; }
      const nNew = Math.min(LESSON_NEW, f), nRev = Math.min(LESSON_REV, rv);
      f -= nNew; rv -= nRev;
      steps.push({ kind: 'new', nNew, nRev, done: false });
    }
    // the review step counts only what the new-word lessons still ahead will not take (5 each)
    const pendingNew = steps.filter(x => x.kind === 'new' && !x.done).length;
    const left = revLeft - Math.min(revLeft, pendingNew * LESSON_REV);
    const total = Math.max(left, P.rev0 - newTotal * LESSON_REV);
    if (total > 0) steps.push({ kind: 'rev', done: revLeft === 0, nNew: 0, nRev: Math.min(REVIEW_LESSON, left || revLeft), left, total });
    // the day closes with a short writing test on today's new words (grammar patterns are asked for their meaning)
    const todays = ids.filter(id => W.byId.has(id)), dd = state.days[dayKey(T)];
    if (todays.length >= 3) steps.push({ kind: 'test', done: !!(dd && dd.dtest), nNew: 0, nRev: 0, n: Math.min(DAILY_TEST, todays.length) });
    const next = steps.findIndex(x => !x.done);
    return { steps, next, finished: next < 0, left: { rev: revLeft, fresh: freshLeft } };
  }
  function statusOf(state, id) {
    const p = state.prog[id];
    return !p ? 'new' : p[0] >= MASTER ? 'master' : 'learn';
  }

  /* ---------- lessons ---------- */
  function reviewType(box, settings, hasAudio) {
    if (settings.review === 'card') return 'card';
    const r = rand();
    let t;
    if (box <= 1) t = r < 0.35 ? 'mcq-ko' : r < 0.6 ? 'mcq-en' : r < 0.8 ? 'cloze' : 'listen';
    else if (box === 2) t = r < 0.3 ? 'spell1' : r < 0.55 ? 'cloze' : r < 0.8 ? 'ctx' : 'mcq-en';
    else if (box <= 4) t = r < 0.3 ? 'spell1' : r < 0.55 ? 'ctx' : r < 0.8 ? 'clozet' : 'dict';
    else t = r < 0.35 ? 'spell' : r < 0.7 ? 'clozet' : 'ctx';
    if (t === 'listen' && !hasAudio) t = 'mcq-ko';
    if (t === 'dict' && !hasAudio) t = 'spell1';
    if (!settings.spell) t = { spell: 'mcq-en', spell1: 'mcq-en', clozet: 'cloze', dict: 'listen' }[t] || t;
    return t;
  }
  function retryType(t) { return t === 'listen' ? 'mcq-ko' : t; }
  function buildLesson(state, W, T, opts = {}) {
    const s = state.settings, hasAudio = !!opts.hasAudio;
    ensurePlan(state, W, T);
    if (opts.extra) state.nt.ids = state.nt.ids.concat(pickNew(state, W, opts.extra, new Set(state.nt.ids)));
    const ntSet = new Set(state.nt.ids);
    const fresh = opts.kind === 'rev' ? [] : state.nt.ids.filter(id => !state.prog[id]).slice(0, LESSON_NEW);
    const pendingNew = state.nt.ids.filter(id => state.prog[id] && state.prog[id][1] <= T);   // missed in a lesson left unfinished
    const due = W.words.filter(e => { const p = state.prog[e.id]; return p && p[1] <= T && !ntSet.has(e.id); })
      .sort((a, b) => state.prog[a.id][1] - state.prog[b.id][1] || state.prog[a.id][0] - state.prog[b.id][0] || a.i - b.i)
      .map(e => e.id);
    const rev = pendingNew.concat(due).slice(0, fresh.length ? LESSON_REV : REVIEW_LESSON);
    const steps = shuffle(rev.map(id => ntSet.has(id) ? { k: 'q', id, qt: 'mcq-ko', nw: 1 } : { k: 'q', id, qt: s.review !== 'card' && multiOK(W.byId.get(id)) && state.prog[id][0] >= 2 && rand() < 0.3 ? 'multi' : reviewType(state.prog[id][0], s, hasAudio) }));
    for (const id of fresh) steps.push({ k: 'learn', id });
    for (const id of shuffle(fresh.slice())) steps.push({ k: 'q', id, qt: 'mcq-ko', nw: 1 });
    if (fresh.length >= 3) steps.push({ k: 'match', ids: shuffle(fresh.slice()) });
    else if (!fresh.length && rev.length >= 4) steps.push({ k: 'match', ids: shuffle(rev.slice()).slice(0, 5) });
    const d = state.days[dayKey(T)];
    return {
      kind: 'lesson', v: 3, T, no: ((d && d.lessons) || 0) + 1, created: Date.now(), steps, i: 0, base: steps.length, fin: 0,
      newIds: fresh, revIds: rev,
      seen: {}, failed: {}, done: {},
      drop: {}, stat: { firstOk: 0, firstN: 0, xp: 0, combo: 0, maxCombo: 0, ms: 0 },
    };
  }
  function lessonUnits(L) {   // screens finished, for the progress bar; a miss counts once its retry is done
    return { total: L.base || 0, done: Math.min(L.fin || 0, L.base || 0) };
  }
  function answerLesson(state, L, correct) {
    const st = L.steps[L.i];
    const res = { xp: 0, first: false, combo: L.stat.combo, retry: false, done: false };
    if (!st) return res;
    if (st.k === 'learn' || st.k === 'match') { L.i++; L.fin = (L.fin || 0) + 1; return res; }
    const id = st.id, T = L.T;
    const first = !L.seen[id];
    L.seen[id] = (L.seen[id] || 0) + 1;
    res.first = first;
    const isNew = !!st.nw;
    if (first) { L.stat.firstN++; if (correct) L.stat.firstOk++; }
    if (correct) { L.stat.combo++; L.stat.maxCombo = Math.max(L.stat.maxCombo, L.stat.combo); } else L.stat.combo = 0;
    const p = state.prog[id];
    let [box, due, reps, lapses] = p ? p.slice(0, 4) : [0, T, 0, 0];
    if (correct) {
      box = L.failed[id] ? ((L.drop && L.drop[id]) || 1) : isNew || !p ? 1 : Math.min(box + 1, MAXBOX);
      due = T + INTERVAL[box];
      reps++;
      L.done[id] = 1;
      res.done = true;
      res.xp = first ? (isNew ? 3 : 2) : 1;
      if (L.stat.combo >= 5 && L.stat.combo % 5 === 0) res.xp += 2;
    } else {
      if (p && !isNew && first) lapses++;
      L.drop = L.drop || {};
      if (!st.r) L.drop[id] = Math.max(1, (p ? p[0] : 1) - 2);   // a miss drops two steps instead of starting over
      box = st.r ? 1 : L.drop[id];
      due = st.r ? T + 1 : T;   // missed again on the retry: no more tries today, it comes back tomorrow
      L.failed[id] = 1;
      state.wrong[id] = [((state.wrong[id] || [0])[0] || 0) + 1, T];
      if (!st.r) {   // asked once more at the end of the lesson
        const again = { k: 'q', id, qt: retryType(st.qt), r: 1 };
        if (st.nw) again.nw = 1;
        const last = L.steps.length - 1, beforeMatch = L.steps[last].k === 'match' && L.i < last;   // retries come before the pairs round
        L.steps.splice(beforeMatch ? last : L.steps.length, 0, again);
        res.retry = true;
      }
    }
    if (correct || st.r) L.fin = (L.fin || 0) + 1;
    state.prog[id] = [box, due, reps, lapses, T];
    const ds = dayStats(state, T);
    addXp(state, ds, res.xp);
    if (first) { ds.t++; if (correct) ds.ok++; }
    if (correct) { if (isNew) ds.n++; else ds.r++; }
    if (!correct && !ds.miss.includes(id)) ds.miss.push(id);
    L.stat.xp += res.xp;
    res.combo = L.stat.combo;
    L.i++;
    return res;
  }
  function answerMatch(state, L, misses) {   // the pairs round: practice only, the schedule does not change
    const st = L.steps[L.i];
    if (!st || st.k !== 'match') return { xp: 0 };
    const xp = Math.max(1, st.ids.length - misses);
    addXp(state, dayStats(state, L.T), xp);
    L.stat.xp += xp;
    L.i++; L.fin = (L.fin || 0) + 1;
    return { xp };
  }
  function finishLesson(state, W, L) {
    const T = L.T, ds = dayStats(state, T), bonus = 10;
    addXp(state, ds, bonus); L.stat.xp += bonus;
    ds.lessons = (ds.lessons || 0) + 1;
    const plan = todayPlan(state, W, T);
    if (!plan.rev && !plan.newLeft) ds.done = true;
    touchBest(state, T);
    return { bonus, plan };
  }

  /* ---------- tests ---------- */
  function rangeIds(state, W, range, T) {
    if (!range) return [];
    if (range.t === 'days') { const set = new Set(range.days || []); return W.words.filter(e => set.has(e.d)).map(e => e.id); }
    if (range.t === 'stars') return W.words.filter(e => state.stars[e.id]).map(e => e.id);
    if (range.t === 'wrong') return W.words.filter(e => state.wrong[e.id]).sort((a, b) => state.wrong[b.id][0] - state.wrong[a.id][0] || a.i - b.i).map(e => e.id);
    if (range.t === 'learned') return W.words.filter(e => state.prog[e.id]).map(e => e.id);
    if (range.t === 'ids') return (range.ids || []).filter(id => W.byId.has(id));
    return [];
  }
  // 'write': a mixed writing test in three blocks, about a third each — meaning -> English (first letter shown),
  // sound -> English, then English -> Korean meaning last, so the keyboard switches to Korean only once.
  // Grammar patterns are only asked for their meaning.
  function writeSteps(W, ids, hasAudio) {
    const pats = ids.filter(id => W.byId.get(id).pat), rest = ids.filter(id => !W.byId.get(id).pat);
    const nKo = Math.min(ids.length, Math.max(pats.length, Math.round(ids.length / 3)));
    const nEn = ids.length - nKo, nSp = hasAudio ? Math.ceil(nEn / 2) : nEn;
    return rest.map((id, i) => ({ k: 'q', id, qt: i < nSp ? 'spell1' : i < nEn ? 'dict' : 'kotype' }))
      .concat(pats.map(id => ({ k: 'q', id, qt: 'kotype' })));
  }
  function buildTest(state, W, spec, T) {
    let ids = rangeIds(state, W, spec.range, T);
    if (spec.qt === 'multi') ids = ids.filter(id => multiOK(W.byId.get(id)));   // only words that have several meanings
    ids = spec.range.t === 'ids' ? ids.slice() : shuffle(ids.slice());
    if (spec.count && spec.count < ids.length) ids = ids.slice(0, spec.count);
    const steps = spec.qt === 'write' ? writeSteps(W, ids, spec.hasAudio)
      : ids.map(id => ({ k: 'q', id, qt: spec.qt === 'mix' ? pick(spec.hasAudio ? MIX_TYPES : MIX_TYPES.filter(t => !AUDIO_TYPES.includes(t))) : spec.qt }));
    return { kind: 'test', T, created: Date.now(), spec, steps, i: 0, answers: [], stat: { ok: 0, n: 0, xp: 0, combo: 0, maxCombo: 0, ms: 0 } };
  }
  function answerTest(state, X, correct) {
    const st = X.steps[X.i];
    const res = { xp: 0, combo: 0 };
    if (!st) return res;
    X.answers.push([st.id, correct ? 1 : 0]);
    X.stat.n++;
    const ds = dayStats(state, X.T);
    if (correct) {
      X.stat.ok++; X.stat.combo++; X.stat.maxCombo = Math.max(X.stat.maxCombo, X.stat.combo);
      res.xp = 1;
    } else {
      X.stat.combo = 0;
      state.wrong[st.id] = [((state.wrong[st.id] || [0])[0] || 0) + 1, X.T];
      const p = state.prog[st.id];
      if (p) state.prog[st.id] = [Math.max(1, p[0] - 2), X.T + 1, p[2], p[3] + 1, X.T];
      if (!ds.miss.includes(st.id)) ds.miss.push(st.id);
    }
    X.stat.xp += res.xp; addXp(state, ds, res.xp);
    res.combo = X.stat.combo;
    X.i++;
    return res;
  }
  function finishTest(state, X) {
    const bonus = X.stat.n ? 5 : 0, ds = dayStats(state, X.T);
    if (X.spec && X.spec.daily) ds.dtest = true;   // today's spelling test is done
    X.stat.xp += bonus; addXp(state, ds, bonus);
    ds.tests = (ds.tests || 0) + 1;
    const wrongIds = X.answers.filter(a => !a[1]).map(a => a[0]);
    state.tests.unshift({ at: Date.now(), T: X.T, label: X.spec.label || '', qt: X.spec.qt, n: X.stat.n, ok: X.stat.ok, ms: X.stat.ms, wrong: wrongIds });
    state.tests = state.tests.slice(0, 60);
    touchBest(state, X.T);
    return { bonus, wrongIds };
  }
  function clearWrong(state, id) { delete state.wrong[id]; }

  return {
    INTERVAL, MAXBOX, MASTER, MIX_TYPES, LESSON_NEW, LESSON_REV, REVIEW_LESSON, DAILY_TEST, dayNum, dayKey, seed, shuffle, pick,
    stems, posOf, synonymsOf, prepare, related, makeQuestion, splitEx, checkSpell, normSpell, checkKo, configure, meaningItems, multiOK,
    defaultSettings, newState, sanitize, fromV1, dayStats, dayMet, addXp, streak, touchBest,
    pickNew, ensurePlan, refreshPlan, todayPlan, dayPlan, planStatus, statusOf,
    buildLesson, lessonUnits, answerLesson, answerMatch, finishLesson,
    rangeIds, buildTest, answerTest, finishTest, clearWrong,
  };
})();
if (typeof module !== 'undefined') module.exports = Logic;
