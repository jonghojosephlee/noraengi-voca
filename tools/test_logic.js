// node test_logic.js — checks question generation over every word and simulates lessons and tests.
const assert = require('assert');
const path = require('path');
const L = require('./src/logic.js');
const fs = require('fs');
const rowsPath = fs.existsSync(path.join(__dirname, 'dist/rows.json')) ? path.join(__dirname, 'dist/rows.json') : path.join(__dirname, '../pwa-data/chorok-voca-data.json');
const rows = require(rowsPath).words;
L.seed(12345);
const W = L.prepare(rows);
assert.ok(W.words.length > 1000, 'friend word list loaded');
const posCount = { v: 0, a: 0, r: 0, n: 0 };
for (const e of W.words) posCount[e.pos]++;
console.log('words', W.words.length, 'pos', posCount);

// 1) question generation invariants for every word and every type
const types = ['mcq-ko', 'mcq-en', 'syn', 'listen', 'spell'];
const fallback = {};
let made = 0;
for (const e of W.words) {
  for (const t of types) {
    for (let rep = 0; rep < 3; rep++) {
      const q = L.makeQuestion(W, e.id, t, true);
      made++;
      assert.ok(q && q.id === e.id, 'question for ' + e.id);
      if (q.t !== t) fallback[t + '->' + q.t] = (fallback[t + '->' + q.t] || 0) + 1;
      if (q.t === 'spell' || q.t === 'card') continue;
      assert.strictEqual(q.opts.length, 4, `${e.id} ${q.t} options`);
      assert.strictEqual(new Set(q.opts).size, 4, `${e.id} ${q.t} unique`);
      assert.ok(q.a >= 0 && q.a < 4, `${e.id} ${q.t} answer index`);
      const correct = q.opts[q.a];
      const others = q.opts.filter((_, i) => i !== q.a);
      if (q.t === 'mcq-ko' || q.t === 'listen') {
        assert.strictEqual(correct, e.senses[q.si].ko);
        for (const o of others) assert.ok(!e.senses.some(s => s.ko === o), `${e.id} distractor equals a meaning`);
        for (const o of others) assert.ok(W.words.some(c => c.senses.some(s => s.ko) && c.senses.find(s => s.ko).ko === o && !L.related(c, e)), `${e.id} related distractor ${o}`);
      } else if (q.t === 'mcq-en') {
        assert.strictEqual(correct, e.w);
        for (const o of others) assert.ok(W.words.some(c => c.w === o && !L.related(c, e)), `${e.id} related word ${o}`);
      } else if (q.t === 'syn') {
        assert.ok(e.synSet.has(correct), `${e.id} synonym answer`);
        for (const o of others) assert.ok(!e.synSet.has(o) && o !== e.key, `${e.id} synonym distractor ${o}`);
      }
    }
  }
}
console.log('questions made', made, 'fallbacks', fallback);

// 1b) example-sentence formats: the blank and the highlight sit on the headword; options are clean
let withEx = 0, cz = 0, cx = 0;
for (const e of W.words) {
  for (let si = 0; si < e.senses.length; si++) {
    if (!e.senses[si].ex) continue;
    withEx++;
    const parts = L.splitEx(e, si);
    assert.ok(parts, `${e.id} s${si} example contains the headword`);
    assert.strictEqual(parts.join(''), e.senses[si].ex);
    assert.strictEqual(parts[1].toLowerCase(), (e.hit || e.w).toLowerCase());
  }
  if (!e.senses.some(s => s.ex)) continue;
  for (let rep = 0; rep < 2; rep++) {
    const c = L.makeQuestion(W, e.id, 'cloze', true);
    if (c.t === 'cloze') {
      cz++;
      const low = e.senses[c.si].ex.toLowerCase();
      assert.strictEqual(c.opts[c.a], e.w);
      assert.strictEqual(new Set(c.opts).size, 4);
      for (const o of c.opts) if (o !== e.w) { const d = W.words.find(x => x.w === o); assert.ok(!L.related(d, e) && !low.includes(d.key), `${e.id} cloze distractor ${o}`); }
    }
    const x = L.makeQuestion(W, e.id, 'ctx', true);
    if (x.t === 'ctx') {
      cx++;
      const low = e.senses[x.si].ex.toLowerCase();
      assert.ok(L.synonymsOf([e.senses[x.si]]).includes(x.opts[x.a]), `${e.id} ctx answer is a synonym of that sense`);
      assert.strictEqual(new Set(x.opts).size, 4);
      for (const o of x.opts) { assert.ok(!low.includes(o), `${e.id} ctx option inside the sentence: ${o}`); if (o !== x.opts[x.a]) assert.ok(!e.synSet.has(o), `${e.id} ctx distractor is a synonym`); }
    }
    const t1 = L.makeQuestion(W, e.id, 'clozet', true);
    assert.ok(e.pat ? t1.t !== 'clozet' : t1.t === 'clozet' && t1.parts[1].toLowerCase() === e.key);
  }
}
const dq = L.makeQuestion(W, '1-1', 'dict', true), dq0 = L.makeQuestion(W, '1-1', 'dict', false), s1q = L.makeQuestion(W, '1-1', 'spell1', true);
assert.ok(dq.t === 'dict' && dq0.t === 'spell' && s1q.t === 'spell' && s1q.lead === 1);
console.log('senses with examples', withEx, 'cloze made', cz, 'context made', cx);

// 2) spelling check on a plain phrase, and patterns are never asked to be typed
const phrase = W.words.find(e => !e.pat && e.w.includes(' '));
assert.ok(L.checkSpell(phrase, phrase.w.toUpperCase()) && L.checkSpell(phrase, ' ' + phrase.w.replace(/ /g, '  ') + ' ') && !L.checkSpell(phrase, phrase.w.split(' ')[0]));
const pat = W.words.find(e => e.pat);
if (pat) for (const t of ['spell', 'spell1', 'dict', 'clozet', 'cloze']) assert.ok(!['spell', 'dict', 'clozet', 'cloze'].includes(L.makeQuestion(W, pat.id, t, true).t), 'pattern not typed: ' + pat.w);

// 2b) writing the Korean meaning: every listed meaning passes as typed, near misses go to the learner's own judgement
let koItems = 0;
for (const e of W.words) for (const s of e.senses) for (const it of s.ko.split(/[,;·/]/)) if (it.trim()) { koItems++; assert.ok(L.checkKo(e, it.trim()), 'own meaning accepted: ' + e.w + ' ' + it); }
const ko = (k, x) => L.checkKo({ senses: [{ ko: k }] }, x);
assert.ok(ko('정리하다, 청소하다', '정리') && ko('정리하다, 청소하다', '청소하다, 정리하다') && !ko('정리하다, 청소하다', '정리, 요리') && !ko('정리하다', ' '));
assert.ok(ko('~에 참가하다', '참가하다') && ko('~에 참가하다', '~에 참가하다') && ko('(~에게 ) ~을 알리다', '알리다') && ko('A 를 B 로 바꾸다', '바꾸다'));
assert.ok(ko('이야기', '이야기') && !ko('이야기', '야기') && ko('은하, 별', '은하') && !ko('~에게 힘을 주다', '주다') && !ko('닫다', '열다'));
console.log('meanings checked', koItems);

// 3) lesson simulation: short lessons of 5 new words (+ up to 5 reviews), or 10 reviews
function runLesson(state, T, pCorrect, opts = {}) {
  const lesson = L.buildLesson(state, W, T, Object.assign({ hasAudio: true }, opts));
  let guard = 0, retries = 0;
  while (lesson.i < lesson.steps.length) {
    const st = lesson.steps[lesson.i];
    if (st.k === 'match') { L.answerMatch(state, lesson, 0); continue; }
    const ok = st.k === 'learn' ? true : Math.random() < pCorrect;
    const r = L.answerLesson(state, lesson, ok);
    if (r.retry) retries++;
    assert.ok(++guard < 100, 'lesson terminates');
  }
  const u = L.lessonUnits(lesson);
  assert.strictEqual(u.done, u.total, 'progress bar full at the end');
  assert.ok(lesson.steps.length <= 2 * lesson.base, 'each question retried at most once');
  L.finishLesson(state, W, lesson);
  return { lesson, retries };
}
const s = L.newState();
const T0 = L.dayNum(Date.UTC(2026, 8, 26, 12));
const r1 = runLesson(s, T0, 0.7);
assert.strictEqual(r1.lesson.newIds.length, 5);
assert.strictEqual(r1.lesson.base, 11, '5 cards + 5 questions + pairs');
assert.deepStrictEqual([...r1.lesson.steps[r1.lesson.base - 1 + r1.retries].ids].sort(), [...r1.lesson.newIds].sort(), 'the pairs round closes the lesson with its new words');
assert.strictEqual(L.streak(s, T0), 1, 'one lesson keeps the streak');
assert.ok(!s.days[L.dayKey(T0)].done);
assert.strictEqual(L.todayPlan(s, W, T0).newLeft, 5);
const r2 = runLesson(s, T0, 0.7);
const newIds = [...r1.lesson.newIds, ...r2.lesson.newIds];
assert.strictEqual(new Set(newIds).size, 10);
for (const id of newIds) { assert.deepStrictEqual(s.prog[id].slice(0, 2), [1, T0 + 1], 'new word scheduled for tomorrow ' + id); }
const d0 = s.days[L.dayKey(T0)];
assert.ok(d0.n <= 10 && d0.n >= 10 - Object.keys(s.wrong).filter(id => s.wrong[id][0] >= 2).length, 'a word missed twice is not counted as learned');
assert.strictEqual(d0.lessons, 2);
assert.ok(d0.done, 'day marked done');
console.log('day0 lessons', r1.lesson.steps.length + '+' + r2.lesson.steps.length, 'screens, retries', r1.retries + r2.retries, 'xp', d0.xp, 'first-try', d0.ok + '/' + d0.t, 'streak', L.streak(s, T0));

// the same day again: nothing left but extra words can be added, one lesson at a time
assert.strictEqual(L.todayPlan(s, W, T0).newLeft, 0);
const nBefore = s.days[L.dayKey(T0)].n;
const extra = runLesson(s, T0, 1, { extra: L.LESSON_NEW });
assert.strictEqual(extra.lesson.newIds.length, 5);
assert.strictEqual(s.days[L.dayKey(T0)].n, nBefore + 5);

// next days: all correct -> boxes climb along the interval ladder; every lesson stays short
let T = T0, maxRev = 0, maxBase = 0;
for (let day = 1; day <= 70; day++) {
  T = T0 + day;
  maxRev = Math.max(maxRev, L.todayPlan(s, W, T).rev);
  let rounds = 0;
  while (L.todayPlan(s, W, T).rev > 0 || L.todayPlan(s, W, T).newLeft > 0) {
    const { lesson } = runLesson(s, T, 1);
    maxBase = Math.max(maxBase, lesson.base);
    assert.ok(lesson.base <= 2 * L.LESSON_NEW + L.LESSON_REV + 1, 'short lesson');
    if (!lesson.newIds.length && lesson.revIds.length >= 4) assert.strictEqual(lesson.steps[lesson.steps.length - 1].k, 'match', 'review lessons end with pairs');
    assert.ok(++rounds <= 20, 'the day finishes');
  }
}
const first15 = [...newIds, ...extra.lesson.newIds];
const boxes = first15.map(id => s.prog[id][0]);
console.log('max reviews in a day', maxRev, 'longest lesson', maxBase, 'screens');
console.log('after 70 perfect days, first 15 words boxes', boxes.join(','), 'streak', L.streak(s, T), 'best', s.best);
assert.ok(boxes.every(b => b >= L.MASTER), 'first words mastered');
assert.strictEqual(L.streak(s, T), 71);

// a wrong answer: back to box 1 and asked once more at the end of the lesson; a second miss waits for tomorrow
const s2 = L.newState();
runLesson(s2, T0, 1); runLesson(s2, T0, 1);
const lesson2 = L.buildLesson(s2, W, T0 + 1, { hasAudio: false });
const firstQ = lesson2.steps.findIndex(x => x.k === 'q' && !x.nw);
assert.ok(firstQ >= 0);
lesson2.i = firstQ;
const wid = lesson2.steps[firstQ].id;
const before = lesson2.steps.length;
L.answerLesson(s2, lesson2, false);
assert.strictEqual(lesson2.steps.length, before + 1);
assert.strictEqual(s2.prog[wid][0], 1);
assert.strictEqual(s2.prog[wid][1], T0 + 1, 'missed word stays due today until its retry');
assert.ok(s2.wrong[wid][0] === 1);
const retryAt = lesson2.steps.findIndex((x, i) => i > firstQ && x.id === wid && x.r);
assert.ok(retryAt === lesson2.steps.length - 2 && lesson2.steps[retryAt + 1].k === 'match', 'retry placed at the end, before the pairs round');
// resume: the lesson object survives JSON round trip
const copy = JSON.parse(JSON.stringify(lesson2));
assert.deepStrictEqual(copy.steps, lesson2.steps);
lesson2.i = retryAt;
const rr = L.answerLesson(s2, lesson2, false);
assert.ok(!rr.retry && lesson2.i === lesson2.steps.length - 1, 'no third try');
assert.ok(L.answerMatch(s2, lesson2, 2).xp === 3 && lesson2.i === lesson2.steps.length, 'pairs round: 5 pairs, 2 misses');
assert.deepStrictEqual(s2.prog[wid].slice(0, 2), [1, T0 + 2], 'second miss comes back tomorrow');
assert.strictEqual(s2.wrong[wid][0], 2);

// every answer wrong: the lesson still ends after one retry per question
const s5 = L.newState();
const worst = runLesson(s5, T0, 0);
assert.strictEqual(worst.lesson.steps.length, worst.lesson.base + 5);
assert.strictEqual(worst.lesson.steps[worst.lesson.steps.length - 1].k, 'match');
for (const id of worst.lesson.newIds) assert.deepStrictEqual(s5.prog[id].slice(0, 2), [1, T0 + 1]);

// today's plan survives a reload: a finished review step stays on the list
{ const s8 = L.newState(); let k8 = 0;
  for (const e of W.words) { if (k8 >= 30) break; s8.prog[e.id] = [3, T0, 2, 0, T0 - 7]; k8++; }
  L.planStatus(s8, W, T0);
  for (const id of Object.keys(s8.prog)) s8.prog[id][1] = T0 + 7;
  const kinds = st => L.planStatus(st, W, T0).steps.map(x => x.kind + (x.done ? '+' : '')).join(' ');
  assert.strictEqual(kinds(L.sanitize(JSON.parse(JSON.stringify(s8)), W)), kinds(s8), 'plan kept across reload'); }
// a half-done lesson saved by the old version is dropped; a finished one is kept so it can be settled
assert.strictEqual(L.sanitize({ lesson: { kind: 'lesson', T: T0, steps: [{ k: 'learn', id: '1-1' }, { k: 'q', id: '1-1' }], i: 1 } }, W).lesson, null);
assert.ok(L.sanitize({ lesson: { kind: 'lesson', T: T0, steps: [{ k: 'learn', id: '1-1' }], i: 1 } }, W).lesson);

// 3b) today's plan: the chosen new words every day, then every review that is due; a miss drops two steps
function runPlanDay(state, T, pCorrect) {
  let guard = 0;
  while (true) {
    const ps = L.planStatus(state, W, T);
    if (ps.finished) return ps;
    const x = ps.steps[ps.next];
    if (x.kind === 'test') {   // today's writing test on the words learned today, in three blocks
      const ids = L.shuffle(state.nt.ids.filter(id => state.prog[id])).slice(0, L.DAILY_TEST);
      const X = L.buildTest(state, W, { range: { t: 'ids', ids }, qt: 'write', hasAudio: true, daily: true }, T);
      const got = X.steps.map(s => L.makeQuestion(W, s.id, s.qt, true).t), order = ['spell', 'dict', 'kotype'];
      assert.ok(X.steps.length === x.n && got.every((q, i) => order.includes(q) && (i === 0 || order.indexOf(q) >= order.indexOf(got[i - 1]))), 'daily test: spell, dict, then kotype');
      assert.ok(X.steps.every((s, i) => !W.byId.get(s.id).pat || got[i] === 'kotype'), 'patterns are asked for their meaning');
      if (X.steps.length >= 9) assert.strictEqual(new Set(got).size, 3, 'all three formats');
      while (X.i < X.steps.length) L.answerTest(state, X, Math.random() < pCorrect);
      L.finishTest(state, X);
      continue;
    }
    const { lesson } = runLesson(state, T, pCorrect, { kind: x.kind });
    assert.ok(lesson.newIds.length === x.nNew, 'lesson matches its step');
    assert.ok(++guard <= 60, 'the plan finishes');
  }
}
const s6 = L.newState();
const p0 = L.planStatus(s6, W, T0);
assert.deepStrictEqual(p0.steps.map(x => x.kind + x.nNew + '/' + x.nRev), ['new5/0', 'new5/0', 'test0/0'], 'first day: two new-word lessons, then the spelling test');
runPlanDay(s6, T0, 1);
assert.ok(L.planStatus(s6, W, T0).finished);
let notes = [], maxDue = 0;
for (let day = 1; day <= 60; day++) {
  const T = T0 + day, before = Object.keys(s6.prog).length;
  maxDue = Math.max(maxDue, L.planStatus(s6, W, T).left.rev);
  runPlanDay(s6, T, 0.8);
  assert.strictEqual(Object.keys(s6.prog).length - before, 10, 'ten new words every day');
  if ([10, 30, 60].includes(day)) notes.push(`day ${day}: ${Object.keys(s6.prog).length} words`);
}
console.log('plan (10 new a day, all reviews, 80% right):', notes.join(' | '), '| most reviews due in a day', maxDue);
// a backlog of 55 reviews keeps both new-word lessons and puts all 55 reviews in one step
const s7 = L.newState(); let k7 = 0;
for (const e of W.words) { if (k7 >= 55) break; s7.prog[e.id] = [4, T0, 3, 0, T0 - 16]; k7++; }
const p7 = L.planStatus(s7, W, T0);
assert.deepStrictEqual(p7.steps.map(x => x.kind), ['new', 'new', 'rev', 'test']);
assert.ok(p7.steps[2].total === 45 && p7.steps[2].left === 45, 'the review step leaves out the 10 reviews the new-word lessons take');
// soft drop: a box-4 word missed and then right on the retry comes back in 3 days (box 2), not tomorrow
const les7 = L.buildLesson(s7, W, T0, { kind: 'rev' });
const q7 = les7.steps.findIndex(x => x.k === 'q'); les7.i = q7; const id7 = les7.steps[q7].id;
L.answerLesson(s7, les7, false);
assert.deepStrictEqual(s7.prog[id7].slice(0, 2), [2, T0]);
les7.i = les7.steps.findIndex((x, j) => j > q7 && x.id === id7 && x.r);
L.answerLesson(s7, les7, true);
assert.deepStrictEqual(s7.prog[id7].slice(0, 2), [2, T0 + 3]);

// 4) tests
const s3 = L.newState();
runLesson(s3, T0, 1);
const test = L.buildTest(s3, W, { range: { t: 'days', days: [1] }, qt: 'mix', count: 20, hasAudio: true, label: 'Day 01' }, T0);
assert.strictEqual(test.steps.length, 20);
let wrongN = 0;
while (test.i < test.steps.length) { const ok = Math.random() < 0.6; if (!ok) wrongN++; L.answerTest(s3, test, ok); }
const fin = L.finishTest(s3, test);
assert.strictEqual(fin.wrongIds.length, wrongN);
assert.strictEqual(s3.tests.length, 1);
for (const id of fin.wrongIds) if (s3.prog[id]) assert.deepStrictEqual(s3.prog[id].slice(0, 2), [1, T0 + 1]);
const wrongRange = L.rangeIds(s3, W, { t: 'wrong' }, T0);
assert.ok(wrongRange.length >= wrongN);
console.log('test ok', test.stat.ok + '/' + test.stat.n, 'wrong list', wrongRange.length);

// 5) migration from the first version
const v1 = { prog: { '1-1': [1, T0, 0, 0, T0], 'bogus': [1, 1, 1, 1, 1] }, meta: { daily: 15, start: 3, front: 'ko', nt: { d: T0, ids: ['1-1'] }, days: { '2026-09-25': { n: 3, r: 0, ok: 2, t: 3, done: false, miss: ['1-1'] } } } };
const m = L.sanitize(L.fromV1(v1), W);
assert.strictEqual(m.settings.daily, 15);
assert.strictEqual(m.settings.start, 3);
assert.ok(m.prog['1-1'] && !m.prog['bogus']);
assert.strictEqual(m.days['2026-09-25'].n, 3);

// 6) start Day and plan refresh
const s4 = L.newState();
const lastDay = W.days[W.days.length - 1]; s4.settings.start = lastDay;
const plan30 = L.todayPlan(s4, W, T0).planned;
assert.ok(plan30.every(id => id.startsWith(lastDay + '-')));
L.ensurePlan(s4, W, T0);
s4.settings.daily = 5; L.refreshPlan(s4, W, T0);
assert.strictEqual(s4.nt.ids.length, 5);

console.log('ALL LOGIC TESTS PASSED');
