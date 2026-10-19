/* Node 단위 테스트:  node test/run.js */
'use strict';
const assert = require('assert');
const path = require('path');
const Q = require(path.join(__dirname, '..', 'js', 'questions.js'));
const S = require(path.join(__dirname, '..', 'js', 'scoring.js'));
const A = require(path.join(__dirname, '..', 'js', 'algorithm.js'));
let P = null;
try { P = require(path.join(__dirname, '..', 'js', 'parse.js')); } catch (e) { /* parse.js 아직 없음 */ }

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function approx(a, b, eps) { assert.ok(Math.abs(a - b) <= (eps || 1e-9), `${a} ≠ ${b}`); }

/* ---------- 합성 데이터 ---------- */
function rng(seed) { return A.mulberry32(seed); }
function makeStudents(n, seed, opts) {
  opts = opts || {};
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const gender = opts.noGender ? null : (i % 2 === 0 ? '남' : '여');
    const items = [];
    const base = 2.5 + r() * 2; // 학생별 성향
    for (let k = 0; k < 32; k++) items.push(Math.max(1, Math.min(5, Math.round(base + (r() - 0.5) * 2))));
    out.push({
      id: 'S' + (i + 1), no: i + 1, name: '학생' + (i + 1), gender,
      papsRaw: { run: 20 + Math.floor(r() * 60), flex1: r() * 30 - 5, flex2: r() * 30 - 5, situp: Math.floor(r() * 100),
                 jump1: 100 + r() * 130, jump2: 100 + r() * 130, height: 150 + r() * 30, weight: 40 + r() * 40 },
      papsGiven: null, items, virtuesGiven: null
    });
  }
  return out;
}

console.log('\n[scoring]');
test('toNum: 문자열/쉼표/결측', () => {
  assert.strictEqual(S.toNum('26'), 26);
  assert.strictEqual(S.toNum(' 25.5 '), 25.5);
  assert.strictEqual(S.toNum('1,234'), 1234);
  assert.strictEqual(S.toNum(''), null);
  assert.strictEqual(S.toNum(null), null);
  assert.strictEqual(S.toNum('-5'), -5);
});
test('sd/zScores: 기본·결측 유지·sd=0', () => {
  approx(S.sd([1, 2, 3, 4]), Math.sqrt(5 / 3));
  const z = S.zScores([1, null, 3]);
  assert.strictEqual(z[1], null);
  approx(z[0], -Math.SQRT1_2); approx(z[2], Math.SQRT1_2);
  assert.deepStrictEqual(S.zScores([2, 2, 2]), [0, 0, 0]);
});
test('bmiScore: 정상범위 0, 밖이면 음수 거리', () => {
  assert.strictEqual(S.bmiScore(170, 60), 0);          // 20.8
  approx(S.bmiScore(160, 40), -(18.5 - 40 / 2.56));    // 15.6
  approx(S.bmiScore(170, 80), -(80 / 2.89 - 23));      // 27.7
  assert.strictEqual(S.bmiScore(null, 60), null);
});
test('papsItemValues: 1·2차 중 더 좋은 값, BMI 토글', () => {
  const iv = S.papsItemValues({ run: '30', flex1: '10', flex2: '12.5', situp: 40, jump1: '180', jump2: null, height: 170, weight: 60 });
  assert.strictEqual(iv.flex, 12.5); assert.strictEqual(iv.jump, 180); assert.strictEqual(iv.bmi, 0);
  assert.strictEqual(S.papsItemValues({ run: 1 }, false).bmi, undefined);
});
test('computeVirtues: 8문항 평균, 5개 미만 응답이면 null, 범위 밖 무시', () => {
  const items = new Array(32).fill(4);
  const v = S.computeVirtues(items);
  assert.deepStrictEqual(v, { 성실: 4, 협동: 4, 정의: 4, 배려: 4 });
  const items2 = items.slice(); items2[0] = null; items2[1] = null; items2[2] = null; items2[3] = 9;
  assert.strictEqual(S.computeVirtues(items2).성실, null);
  items2[3] = 2; items2[2] = 2; // 성실: 2,2,4,4,4,4,4 → 6개 유효
  approx(S.computeVirtues(items2).성실, (2 + 2 + 4 * 4) / 6);
});
test('computePapsZ: 성별 전원 있으면 성별 내 z (auto)', () => {
  const st = makeStudents(10, 3);
  const r1 = S.computePapsZ(st, { zByGender: 'auto' });
  assert.deepStrictEqual(r1.groupKeys.sort(), ['남', '여']);
  const r2 = S.computePapsZ(st, { zByGender: 'class' });
  assert.deepStrictEqual(r2.groupKeys, ['all']);
  // 성별 내 z 평균은 0
  const males = st.filter(s => s.gender === '남').map(s => r1.byId[s.id]);
  approx(S.mean(males), 0, 1e-9);
});
test('computePapsZ: 등급 입력은 부호 반전 (1등급이 최상)', () => {
  const st = [{ id: 'a', papsGiven: 1 }, { id: 'b', papsGiven: 3 }, { id: 'c', papsGiven: 5 }];
  const r = S.computePapsZ(st, { papsGivenType: 'grade' });
  assert.ok(r.byId.a > r.byId.b && r.byId.b > r.byId.c);
  const r2 = S.computePapsZ(st, { papsGivenType: 'score' });
  assert.ok(r2.byId.a < r2.byId.c);
});
test('prepareStudents: 결측 대체 + 플래그', () => {
  const st = makeStudents(6, 5);
  st[0].papsRaw = null; st[1].items = null;
  const p = S.prepareStudents(st, {});
  assert.strictEqual(p[0].papsImputed, true); assert.strictEqual(p[0].papsZ, 0);
  assert.strictEqual(p[1].virtueImputed, true);
  assert.ok(typeof p[1].virtues.성실 === 'number');
  assert.strictEqual(p[2].papsImputed, false); assert.strictEqual(p[2].virtueImputed, false);
});

console.log('\n[algorithm]');
function check(result, students, K, opts) {
  const teams = result.teams;
  assert.strictEqual(teams.length, K);
  const all = teams.flat();
  assert.strictEqual(all.length, students.length, '전원 배치');
  assert.strictEqual(new Set(all).size, students.length, '중복 없음');
  const sizes = teams.map(t => t.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, '팀 크기 차 ≤1: ' + sizes);
  if (opts && opts.genderBalance) {
    const byId = {}; students.forEach(s => byId[s.id] = s);
    for (const g of ['남', '여']) {
      const c = teams.map(t => t.filter(id => byId[id].gender === g).length);
      assert.ok(Math.max(...c) - Math.min(...c) <= 1, g + ' 수 차 ≤1: ' + c);
    }
  }
}
const base = S.prepareStudents(makeStudents(28, 11), {});
test('buildTeams: 28명 6팀, 크기·성별 균형, 재현성', () => {
  const r1 = A.buildTeams(base, { teamCount: 6, seed: 1 });
  check(r1, base, 6, { genderBalance: true });
  const r2 = A.buildTeams(base, { teamCount: 6, seed: 1 });
  assert.deepStrictEqual(r1.teams, r2.teams, '같은 시드 → 같은 결과');
  const r3 = A.buildTeams(base, { teamCount: 6, seed: 2 });
  assert.notDeepStrictEqual(r1.teams, r3.teams, '다른 시드 → 다른 결과');
});
test('buildTeams: PAPS 범위가 허용편차 안이고, 랜덤 배치보다 인성 편차가 작다', () => {
  const r = A.buildTeams(base, { teamCount: 6, seed: 7, papsTolerance: 0.3 });
  assert.ok(r.stats.Dp <= 0.3 + 1e-9, 'Dp=' + r.stats.Dp);
  // 랜덤 배치 100회 평균 Dc
  const rr = rng(99); let sum = 0;
  for (let k = 0; k < 100; k++) {
    const ids = base.map(s => s.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const teams = Array.from({ length: 6 }, () => []);
    ids.forEach((id, i) => teams[i % 6].push(id));
    sum += A.evaluateTeams(base, teams).Dc;
  }
  const randDc = sum / 100;
  assert.ok(r.stats.Dc < randDc * 0.6, `Dc ${r.stats.Dc.toFixed(3)} vs random ${randDc.toFixed(3)}`);
  assert.ok(r.equity >= 70, 'equity=' + r.equity);
});
test('buildTeams: 성별 균형 끔 / 성별 없음 / 홀수 인원', () => {
  const st = S.prepareStudents(makeStudents(27, 12, { noGender: true }), {});
  const r = A.buildTeams(st, { teamCount: 5, seed: 3, genderBalance: true });
  check(r, st, 5, {});
  const r2 = A.buildTeams(base, { teamCount: 4, seed: 3, genderBalance: false });
  check(r2, base, 4, {});
});
test('buildTeams: 고정·함께·분리 제약 준수', () => {
  const opts = { teamCount: 5, seed: 4, pinned: { S1: 2, S4: 0 }, together: [['S2', 'S6']], apart: [['S3', 'S5'], ['S7', 'S9']] };
  const r = A.buildTeams(base, opts);
  check(r, base, 5, { genderBalance: true });
  const teamOf = {}; r.teams.forEach((t, i) => t.forEach(id => teamOf[id] = i));
  assert.strictEqual(teamOf.S1, 2); assert.strictEqual(teamOf.S4, 0);
  assert.strictEqual(teamOf.S2, teamOf.S6, '함께');
  assert.notStrictEqual(teamOf.S3, teamOf.S5, '분리1');
  assert.notStrictEqual(teamOf.S7, teamOf.S9, '분리2');
});
test('buildTeams: 소규모·극단 (N<2K, K=1, N=0)', () => {
  const st = S.prepareStudents(makeStudents(5, 2), {});
  const r = A.buildTeams(st, { teamCount: 3, seed: 1 });
  check(r, st, 3, { genderBalance: true });
  assert.ok(r.log.some(m => m.includes('2배')));
  const r1 = A.buildTeams(st, { teamCount: 1, seed: 1 });
  assert.strictEqual(r1.teams[0].length, 5);
  const r0 = A.buildTeams([], { teamCount: 3 });
  assert.strictEqual(r0.stats, null);
});
test('evaluateTeams: 수동 조정 후 통계 재계산', () => {
  const r = A.buildTeams(base, { teamCount: 6, seed: 1 });
  const teams = r.teams.map(t => t.slice());
  const a = teams[0][0]; teams[0][0] = teams[1][0]; teams[1][0] = a;
  const st = A.evaluateTeams(base, teams);
  assert.strictEqual(st.teams.length, 6);
  assert.ok(typeof st.equity === 'number');
  const same = A.evaluateTeams(base, r.teams);
  approx(same.Dc, r.stats.Dc); approx(same.Dp, r.stats.Dp);
});
test('genderQuotas: 팀별 총원과 성별 쿼터 일치 (무작위 100회)', () => {
  const r = rng(5);
  for (let k = 0; k < 100; k++) {
    const K = 2 + Math.floor(r() * 7), m = Math.floor(r() * 20), f = Math.floor(r() * 20), u = Math.floor(r() * 3);
    const N = m + f + u; if (N === 0) continue;
    const sizes = A._internal.teamSizes(N, K, r);
    const q = A._internal.genderQuotas(sizes, { 남: m, 여: f, 미상: u }, r);
    for (let t = 0; t < K; t++) assert.strictEqual(q['남'][t] + q['여'][t] + q['미상'][t], sizes[t], `K=${K} m=${m} f=${f} u=${u}`);
    for (const g of ['남', '여', '미상']) assert.ok(Math.max(...q[g]) - Math.min(...q[g]) <= 1);
  }
});
test('성능: 30명 8팀 5회 재시작 < 2초', () => {
  const st = S.prepareStudents(makeStudents(30, 21), {});
  const t0 = Date.now();
  A.buildTeams(st, { teamCount: 8, seed: 1 });
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, ms + 'ms');
  console.log('       (' + ms + 'ms)');
});

if (P) {
  console.log('\n[parse]');
  test('헤더 탐지: NEIS 양식', () => {
    const rows = [
      ['학년도', '과정명', '계열명', '학년', '학과명', '반명', '반코드', '번호', '학생성명', '왕복오래달리기(회)', '앉아윗몸 앞으로 굽히기(cm) 1차', '앉아윗몸 앞으로 굽히기(cm) 2차', '윗몸말아올리기(회)', '제자리멀리뛰기(cm) 1차', '제자리멀리뛰기(cm) 2차', '신장(cm)', '체중(kg)'],
      [2026, '주간', '일반계', '1', '일반학과', '1', '01', '1', '김가명', '26', '26', '25.5', 60, '160', '155', '150.4', '45'],
      [2026, '주간', '일반계', '1', '일반학과', '1', '01', '2', '이가명', '37', '29', '29.5', 40, '165', '175', '164.3', '57']
    ];
    const det = P.detectTable(rows);
    assert.strictEqual(det.headerRow, 0);
    const m = det.mapping;
    assert.strictEqual(m.no, 7); assert.strictEqual(m.name, 8);
    assert.strictEqual(m.run, 9); assert.strictEqual(m.flex1, 10); assert.strictEqual(m.flex2, 11);
    assert.strictEqual(m.situp, 12); assert.strictEqual(m.jump1, 13); assert.strictEqual(m.jump2, 14);
    assert.strictEqual(m.height, 15); assert.strictEqual(m.weight, 16);
    const recs = P.extractStudents(rows, det);
    assert.strictEqual(recs.length, 2);
    assert.strictEqual(recs[0].no, 1); assert.strictEqual(recs[0].name, '김가명');
    assert.strictEqual(recs[1].papsRaw.flex2, 29.5);
  });
  test('헤더 탐지: 구글폼 32문항 (원문 헤더 + B문항 제외 + 성별)', () => {
    const header = ['타임스탬프', '학급', '번호', '성별'].concat(Q.ITEMS.map((t, i) => (i + 1) + '. ' + t)).concat(Q.B_ITEMS.map((t, i) => 'B' + (i + 1) + '. ' + t));
    const row = ['2026-10-10 9:00', '1-3', '5', '여'].concat(new Array(32).fill(4)).concat([3, 3, 3, 3, 3]);
    const det = P.detectTable([header, row]);
    assert.strictEqual(det.mapping.no, 2); assert.strictEqual(det.mapping.gender, 3);
    assert.strictEqual(det.mapping.items.length, 32);
    assert.strictEqual(det.mapping.items[0], 4); assert.strictEqual(det.mapping.items[31], 35);
    const recs = P.extractStudents([header, row], det);
    assert.strictEqual(recs[0].gender, '여'); assert.strictEqual(recs[0].items.length, 32);
  });
  test('헤더 탐지: 숫자 헤더 1~32, 4덕목 열, PAPS 총점 열', () => {
    const header = ['번호', '이름'].concat(Array.from({ length: 32 }, (_, i) => String(i + 1)));
    const det = P.detectTable([header, ['1', '가', ...new Array(32).fill(3)]]);
    assert.strictEqual(det.mapping.items.length, 32);
    const h2 = ['번호', '이름', '성실', '협동', '정의', '배려', 'PAPS 총점'];
    const d2 = P.detectTable([h2, ['1', '가', 4, 3.5, 4.2, 3.9, 78]]);
    assert.strictEqual(d2.mapping.v_성실, 2); assert.strictEqual(d2.mapping.v_배려, 5); assert.strictEqual(d2.mapping.papsGiven, 6);
    const recs = P.extractStudents([h2, ['1', '가', 4, 3.5, 4.2, 3.9, 78]], d2);
    assert.strictEqual(recs[0].virtuesGiven.협동, 3.5); assert.strictEqual(recs[0].papsGiven, 78);
  });
  test('붙여넣기 텍스트 → 표', () => {
    const rows = P.parseDelimitedText('번호\t이름\t성별\n1\t김가명\t남\n2\t이가명\t여\n');
    assert.strictEqual(rows.length, 3); assert.strictEqual(rows[1][1], '김가명');
    const csv = P.parseDelimitedText('번호,이름,"비고, 쉼표"\n1,가,"a, b"');
    assert.strictEqual(csv[1][2], 'a, b');
  });
  test('병합: 번호 기준, 한쪽만 있는 학생 표시', () => {
    const paps = [{ no: 1, name: '가', papsRaw: { run: 1 } }, { no: 2, name: '나', papsRaw: { run: 2 } }];
    const survey = [{ no: 2, name: '나', gender: '여', items: new Array(32).fill(3) }, { no: 3, name: '다', gender: '남', items: new Array(32).fill(4) }];
    const merged = P.mergeStudents(paps, survey);
    assert.strictEqual(merged.length, 3);
    const byNo = {}; merged.forEach(s => byNo[s.no] = s);
    assert.strictEqual(byNo[1].source.paps, true); assert.strictEqual(byNo[1].source.survey, false);
    assert.strictEqual(byNo[2].source.paps, true); assert.strictEqual(byNo[2].source.survey, true); assert.strictEqual(byNo[2].gender, '여');
    assert.strictEqual(byNo[3].source.paps, false); assert.strictEqual(byNo[3].papsRaw, null);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
