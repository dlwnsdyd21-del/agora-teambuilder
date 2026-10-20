/* Node 단위 테스트:  node test/run.js */
'use strict';
const assert = require('assert');
const path = require('path');
const Q = require(path.join(__dirname, '..', 'js', 'questions.js'));
const T = require(path.join(__dirname, '..', 'js', 'paps_table.js'));
const S = require(path.join(__dirname, '..', 'js', 'scoring.js'));
const A = require(path.join(__dirname, '..', 'js', 'algorithm.js'));
const P = require(path.join(__dirname, '..', 'js', 'parse.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function approx(a, b, eps) { assert.ok(Math.abs(a - b) <= (eps || 1e-9), `${a} ≠ ${b}`); }

/* ---------- 합성 데이터 (중1) ---------- */
function rng(seed) { return A.mulberry32(seed); }
function makeStudents(n, seed, opts) {
  opts = opts || {};
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const gender = opts.noGender ? null : (i % 2 === 0 ? '남' : '여');
    const items = [];
    const base = 2.5 + r() * 2;
    for (let k = 0; k < 32; k++) items.push(Math.max(1, Math.min(5, Math.round(base + (r() - 0.5) * 2))));
    const m = gender !== '여';
    out.push({
      id: 'S' + (i + 1), no: i + 1, name: '학생' + (i + 1), gender, grade: 1,
      papsRaw: { run: Math.floor((m ? 15 : 10) + r() * (m ? 60 : 55)), flex1: r() * 30 - 5, flex2: r() * 30 - 5, situp: Math.floor(r() * (m ? 130 : 62)),
                 jump1: (m ? 120 : 90) + r() * 100, jump2: (m ? 120 : 90) + r() * 100, height: 150 + r() * 25, weight: 40 + r() * 35 },
      papsGiven: null, items, virtuesGiven: null
    });
  }
  return out;
}

console.log('\n[paps_table]');
test('별표5 예시: 초5 남 왕복오래달리기 점수 구간', () => {
  const bands = T.BANDS['남'].run['초5'];
  const pts = v => T.pointsFromBands(v, bands, 1, false).points;
  assert.deepStrictEqual([21, 22, 23, 24, 25, 26, 27, 28].map(pts), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.deepStrictEqual([29, 33, 34, 39, 40, 44, 45, 49].map(pts), [4, 4, 5, 5, 6, 6, 7, 7]);
  assert.deepStrictEqual([100, 101, 102, 103, 104, 105, 106, 107, 150].map(pts), [16, 16, 17, 17, 18, 19, 19, 20, 20]);
  assert.strictEqual(T.pointsFromBands(50, bands, 1, false).grade, 3);
  assert.strictEqual(T.pointsFromBands(73, bands, 1, false).grade, 2);
  // 3등급 50~72 → 8~11, 2등급 73~99 → 12~15, 단조 증가
  let prev = -1;
  for (let v = 20; v <= 110; v++) { const p = pts(v); assert.ok(p >= prev, 'monotonic at ' + v); prev = p; }
  assert.ok(pts(50) === 8 && pts(72) === 11 && pts(73) === 12 && pts(99) === 15);
});
test('시간 종목(50m)은 낮을수록 좋음, 소수 종목(cm) 0.1 단위', () => {
  const b50 = T.BANDS['남'].run50['중1'];
  const p = v => T.pointsFromBands(v, b50, 0.01, true);
  assert.strictEqual(p(12.60).points, 0); assert.strictEqual(p(12.51).points, 0);
  assert.strictEqual(p(7.40).points, 20); assert.strictEqual(p(7.0).points, 20);
  assert.ok(p(7.45).points >= 16 && p(7.45).points <= 19 && p(7.45).grade === 1);
  assert.ok(p(9.0).grade === 3 && p(9.0).points >= 8 && p(9.0).points <= 11);
  let prev = 21;
  for (let v = 7.0; v <= 13; v += 0.01) { const x = p(v).points; assert.ok(x <= prev, 'monotonic ' + v); prev = x; }
  const bf = T.BANDS['여'].flex['중1'];
  const f = v => T.pointsFromBands(v, bf, 0.1, false);
  assert.strictEqual(f(-0.1).points, 0); assert.strictEqual(f(28.0).points, 20);
  assert.ok(f(9.0).grade === 3 && f(12.0).grade === 2 && f(1.0).grade === 5 && f(1.0).points >= 1);
});
test('BMI: 정상 20점, 과체중 2등급, 마름 3등급, 비만 4·5등급', () => {
  const m1 = v => T.bmiPoints(v, '남', '중1');
  assert.deepStrictEqual(m1(20.0), { points: 20, grade: 1, category: '정상' });
  assert.strictEqual(m1(15.4).points, 20); assert.strictEqual(m1(23.2).points, 20);
  const over = m1(24.0); assert.ok(over.grade === 2 && over.points >= 12 && over.points <= 15 && over.category === '과체중');
  assert.ok(m1(23.3).points === 15 && m1(24.9).points === 12);
  const thin = m1(15.0); assert.ok(thin.grade === 3 && thin.points >= 8 && thin.points <= 11);
  assert.ok(m1(12.0).points === 8);
  const mild = m1(27.0); assert.ok(mild.grade === 4 && mild.points >= 4 && mild.points <= 7);
  assert.ok(m1(25.0).points === 7 && m1(29.9).points === 4);
  const sev = m1(31.0); assert.ok(sev.grade === 5 && sev.points >= 1 && sev.points <= 3);
  assert.strictEqual(m1(40).points, 0);
  // 고2 남: 과체중 구분 없음 → 25.0~29.9 경도비만
  assert.strictEqual(T.bmiPoints(26, '남', '고2').grade, 4);
  assert.strictEqual(T.bmiPoints(20, '여', '중3').points, 20);
});
test('gradeFromTotal / hasTable / 표 무결성', () => {
  assert.deepStrictEqual([100, 80, 79, 60, 59, 40, 39, 20, 19, 0].map(T.gradeFromTotal), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.ok(T.hasTable('남', '중1') && T.hasTable('여', '고3') && !T.hasTable('남', '중7') && !T.hasTable(null, '중1'));
  for (const g of ['남', '여']) for (const item of Object.keys(T.BANDS[g])) for (const gk of Object.keys(T.BANDS[g][item])) {
    const b = T.BANDS[g][item][gk];
    assert.strictEqual(b.length, 5, `${g} ${item} ${gk}`);
    const lower = T.ITEMS[item].lowerIsBetter;
    for (let i = 0; i < 5; i++) assert.ok(b[i][0] <= b[i][1], `${g} ${item} ${gk} band ${i}`);
    for (let i = 0; i < 4; i++) assert.ok(lower ? b[i + 1][1] <= b[i][0] : b[i][1] <= b[i + 1][0], `${g} ${item} ${gk} order ${i}`);
  }
});

console.log('\n[scoring]');
test('toNum: 문자열/쉼표/결측', () => {
  assert.strictEqual(S.toNum('26'), 26);
  assert.strictEqual(S.toNum(' 25.5 '), 25.5);
  assert.strictEqual(S.toNum('1,234'), 1234);
  assert.strictEqual(S.toNum(''), null);
  assert.strictEqual(S.toNum(null), null);
  assert.strictEqual(S.toNum('-5'), -5);
});
test('bmiValue: 0.01 단위 올림', () => {
  approx(S.bmiValue(170, 60), 20.8);   // 20.76 → 20.8
  approx(S.bmiValue(160, 47.36), 18.5); // 18.5 → 18.5
  assert.strictEqual(S.bmiValue(null, 60), null);
});
test('papsItemValues: 1·2차 중 더 좋은 값, BMI 토글', () => {
  const iv = S.papsItemValues({ run: '30', flex1: '10', flex2: '12.5', situp: 40, jump1: '180', jump2: null, height: 170, weight: 60 });
  assert.strictEqual(iv.flex, 12.5); assert.strictEqual(iv.jump, 180); approx(iv.bmi, 20.8);
  assert.strictEqual(S.papsItemValues({ run: 1 }, false).bmi, undefined);
});
test('computePapsPoints: 공식 기준표(중1 남) 5영역 합계', () => {
  const st = [{ id: 'a', gender: '남', grade: 1, papsRaw: { run: 64, flex1: 10.0, flex2: 9.0, situp: 90, jump1: 211.1, jump2: 200, height: 170, weight: 60 } }];
  const r = S.computePapsPoints(st, { schoolLevel: '중' });
  const d = r.detail.a;
  assert.strictEqual(d.source, 'official'); assert.strictEqual(d.gradeKey, '중1');
  assert.strictEqual(d.items.run.points, 16); assert.strictEqual(d.items.flex.points, 16);
  assert.strictEqual(d.items.situp.points, 16); assert.strictEqual(d.items.jump.points, 16); assert.strictEqual(d.items.bmi.points, 20);
  assert.strictEqual(d.nAreas, 5); assert.strictEqual(d.scaled, false); assert.strictEqual(d.total, 84); assert.strictEqual(d.grade, 1);
  const r2 = S.computePapsPoints(st, { schoolLevel: '중', includeBmi: false });
  assert.strictEqual(r2.detail.a.nAreas, 4); assert.strictEqual(r2.detail.a.scaled, true); approx(r2.detail.a.total, 64 * 5 / 4);
});
test('computePapsPoints: 성별 없으면 학급 내 상대점수, 총점/등급 직접 입력', () => {
  const st = makeStudents(10, 3, { noGender: true });
  const r = S.computePapsPoints(st, {});
  assert.strictEqual(r.detail.S1.source, 'relative');
  assert.ok(r.byId.S1 >= 0 && r.byId.S1 <= 100);
  const given = [{ id: 'g', papsGiven: 77 }, { id: 'h', papsGiven: 2 }];
  assert.strictEqual(S.computePapsPoints(given, { papsGivenType: 'score' }).byId.g, 77);
  assert.strictEqual(S.computePapsPoints(given, { papsGivenType: 'grade' }).byId.h, 70);
});
test('computeVirtues: 8문항 평균, 5개 미만 응답이면 null, 범위 밖 무시', () => {
  const items = new Array(32).fill(4);
  assert.deepStrictEqual(S.computeVirtues(items), { 성실: 4, 협동: 4, 정의: 4, 배려: 4 });
  const items2 = items.slice(); items2[0] = null; items2[1] = null; items2[2] = null; items2[3] = 9;
  assert.strictEqual(S.computeVirtues(items2).성실, null);
  items2[3] = 2; items2[2] = 2;
  approx(S.computeVirtues(items2).성실, (2 + 2 + 4 * 4) / 6);
});
test('prepareStudents: 점수·등급·결측 대체 플래그', () => {
  const st = makeStudents(6, 5);
  st[0].papsRaw = null; st[1].items = null;
  const p = S.prepareStudents(st, { schoolLevel: '중' });
  assert.strictEqual(p[0].papsImputed, true); assert.ok(typeof p[0].papsPoints === 'number');
  assert.strictEqual(p[1].virtueImputed, true);
  assert.strictEqual(p[2].papsImputed, false); assert.strictEqual(p[2].papsDetail.source, 'official');
  assert.ok(p[2].papsGrade >= 1 && p[2].papsGrade <= 5);
  assert.ok(p.every(x => x.papsPoints >= 0 && x.papsPoints <= 100));
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
const base = S.prepareStudents(makeStudents(28, 11), { schoolLevel: '중' });
test('buildTeams: 28명 6팀, 크기·성별 균형, 재현성', () => {
  const r1 = A.buildTeams(base, { teamCount: 6, seed: 1 });
  check(r1, base, 6, { genderBalance: true });
  const r2 = A.buildTeams(base, { teamCount: 6, seed: 1 });
  assert.deepStrictEqual(r1.teams, r2.teams, '같은 시드 → 같은 결과');
  const r3 = A.buildTeams(base, { teamCount: 6, seed: 2 });
  assert.notDeepStrictEqual(r1.teams, r3.teams, '다른 시드 → 다른 결과');
});
test('buildTeams: PAPS 팀 평균 범위가 허용편차(점) 안이고, 랜덤 배치보다 인성 편차가 작다', () => {
  const r = A.buildTeams(base, { teamCount: 6, seed: 7, papsTolerance: 4 });
  assert.ok(r.stats.Dp <= 4 + 1e-9, 'Dp=' + r.stats.Dp);
  assert.ok(r.stats.metrics.PAPS.teamMeans.every(m => m >= 0 && m <= 100));
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

console.log('\n[parse]');
test('헤더 탐지: NEIS 양식 (학년 포함)', () => {
  const rows = [
    ['학년도', '과정명', '계열명', '학년', '학과명', '반명', '반코드', '번호', '학생성명', '왕복오래달리기(회)', '앉아윗몸 앞으로 굽히기(cm) 1차', '앉아윗몸 앞으로 굽히기(cm) 2차', '윗몸말아올리기(회)', '제자리멀리뛰기(cm) 1차', '제자리멀리뛰기(cm) 2차', '신장(cm)', '체중(kg)'],
    [2026, '주간', '일반계', '1', '일반학과', '1', '01', '1', '김가명', '26', '26', '25.5', 60, '160', '155', '150.4', '45'],
    [2026, '주간', '일반계', '1', '일반학과', '1', '01', '2', '이가명', '37', '29', '29.5', 40, '165', '175', '164.3', '57']
  ];
  const det = P.detectTable(rows);
  assert.strictEqual(det.headerRow, 0);
  const m = det.mapping;
  assert.strictEqual(m.no, 7); assert.strictEqual(m.name, 8); assert.strictEqual(m.grade, 3);
  assert.strictEqual(m.run, 9); assert.strictEqual(m.flex1, 10); assert.strictEqual(m.flex2, 11);
  assert.strictEqual(m.situp, 12); assert.strictEqual(m.jump1, 13); assert.strictEqual(m.jump2, 14);
  assert.strictEqual(m.height, 15); assert.strictEqual(m.weight, 16);
  const recs = P.extractStudents(rows, det);
  assert.strictEqual(recs.length, 2);
  assert.strictEqual(recs[0].no, 1); assert.strictEqual(recs[0].name, '김가명'); assert.strictEqual(recs[0].grade, 1);
  assert.strictEqual(recs[1].papsRaw.flex2, 29.5);
});
test('헤더 탐지: 50m·악력·팔굽혀펴기 열', () => {
  const h = ['번호', '이름', '성별', '50m달리기(초)', '악력(kg)', '팔굽혀펴기(회)'];
  const det = P.detectTable([h, [1, '가', '남', 8.5, 30.2, 20]]);
  assert.strictEqual(det.mapping.run50, 3); assert.strictEqual(det.mapping.grip, 4); assert.strictEqual(det.mapping.pushup, 5);
  const recs = P.extractStudents([h, [1, '가', '남', 8.5, 30.2, 20]], det);
  assert.strictEqual(recs[0].papsRaw.run50, 8.5); assert.strictEqual(recs[0].papsRaw.grip, 30.2); assert.strictEqual(recs[0].papsRaw.pushup, 20);
  const r = S.computePapsPoints([Object.assign({ id: 'x', grade: 1 }, recs[0])], { schoolLevel: '중' });
  assert.strictEqual(r.detail.x.nAreas, 2); assert.strictEqual(r.detail.x.areas['순발력'].key, 'run50');
  assert.strictEqual(r.detail.x.areas['근력·근지구력'].key, 'pushup');
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
  const paps = [{ no: 1, name: '가', grade: 1, papsRaw: { run: 1 } }, { no: 2, name: '나', papsRaw: { run: 2 } }];
  const survey = [{ no: 2, name: '나', gender: '여', items: new Array(32).fill(3) }, { no: 3, name: '다', gender: '남', items: new Array(32).fill(4) }];
  const merged = P.mergeStudents(paps, survey);
  assert.strictEqual(merged.length, 3);
  const byNo = {}; merged.forEach(s => byNo[s.no] = s);
  assert.strictEqual(byNo[1].source.paps, true); assert.strictEqual(byNo[1].source.survey, false); assert.strictEqual(byNo[1].grade, 1);
  assert.strictEqual(byNo[2].source.paps, true); assert.strictEqual(byNo[2].source.survey, true); assert.strictEqual(byNo[2].gender, '여');
  assert.strictEqual(byNo[3].source.paps, false); assert.strictEqual(byNo[3].papsRaw, null);
});

test('likertValue / parseHakbun', () => {
  assert.deepStrictEqual(['① 전혀 그렇지 않다', '② 그렇지 않다', '③ 보통이다', '④ 그렇다', '⑤ 매우 그렇다', 4, '3', '5 (매우 그렇다)', '그렇다', '', null].map(P.likertValue), [1, 2, 3, 4, 5, 4, 3, 5, 4, null, null]);
  assert.deepStrictEqual(P.parseHakbun('10130 홍길동'), { grade: 1, cls: 1, no: 30, name: '홍길동' });
  assert.deepStrictEqual(P.parseHakbun('30605'), { grade: 3, cls: 6, no: 5, name: null });
  assert.deepStrictEqual(P.parseHakbun('7번 김가명'), { grade: null, cls: null, no: 7, name: '김가명' });
  assert.strictEqual(P.parseHakbun(''), null);
});
test('나이스 학급별건강체력평가조회 양식: 2줄 헤더·반복 헤더·영역 점수·성별/학년 추정', () => {
  const XLSX = require(path.join(__dirname, '..', 'vendor', 'xlsx.full.min.js'));
  const fs = require('fs');
  const wb = XLSX.read(fs.readFileSync(path.join(__dirname, '..', 'sample', '나이스_건강체력평가조회_샘플.xlsx')), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false });
  const det = P.detectTable(rows);
  assert.strictEqual(det.headerRow, 4); assert.ok(det.meta.twoRowHeader && det.meta.neis);
  assert.strictEqual(det.meta.gradeHint, 1);
  const m = det.mapping;
  assert.strictEqual(m.no, 0); assert.strictEqual(m.name, 1); assert.strictEqual(m.papsGiven, 2);
  assert.strictEqual(m.run, 4); assert.strictEqual(m['pts_심폐'], 7); assert.strictEqual(m.flex1, 9); assert.strictEqual(m['pts_유연'], 13);
  assert.strictEqual(m.pushup, 17); assert.strictEqual(m.situp, 18); assert.strictEqual(m.grip, 19); assert.strictEqual(m['pts_근력'], 20);
  assert.strictEqual(m.run50, 23); assert.strictEqual(m.jump1, 24); assert.strictEqual(m['pts_순발'], 25); assert.strictEqual(m.bmi, 28); assert.strictEqual(m['pts_체지방'], 29); assert.strictEqual(m.bmiCat, 30);
  assert.strictEqual(m.flex2, undefined); assert.strictEqual(m.jump2, undefined);
  const recs = P.extractStudents(rows, det);
  assert.strictEqual(recs.length, 28, '반복 헤더 행 제외');
  assert.ok(recs.every(x => x.name !== '성명'));
  assert.strictEqual(recs[0].grade, 1);
  assert.deepStrictEqual(Object.keys(recs[0].papsNeis.areas).sort(), ['근력', '순발', '심폐', '유연', '체지방']);
  assert.strictEqual(recs[0].papsNeis.total, recs[0].papsGiven);
  const st = P.mergeStudents(recs, []);
  const inf = S.inferFromNeis(st, {});
  assert.strictEqual(inf.gradeKey, '고1'); assert.ok(inf.gradeKeyShare > 0.95, 'share ' + inf.gradeKeyShare);
  assert.strictEqual(inf.inferred, 27);
  st.forEach(s => { const r = inf.byId[s.id]; if (r) s.gender = r.gender; });
  assert.ok(st.filter(s => s.gender === '남').length === 14 || st.filter(s => s.gender === '남').length === 13);
  const prep = S.prepareStudents(st, { schoolLevel: '고', defaultGrade: 1 });
  prep.forEach(p => { if (p.papsNeis) { assert.strictEqual(p.papsDetail.source, 'neis'); approx(p.papsPoints, p.papsNeis.total); } });
  assert.strictEqual(prep.find(p => p.no === 27).papsImputed, true);
});
test('구글폼 응답 양식: 학번·객관식 글자 응답 → 번호·이름·학년·1~5점', () => {
  const XLSX = require(path.join(__dirname, '..', 'vendor', 'xlsx.full.min.js'));
  const fs = require('fs');
  const wb = XLSX.read(fs.readFileSync(path.join(__dirname, '..', 'sample', '인성설문_구글폼응답_샘플.xlsx')), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false });
  const det = P.detectTable(rows);
  assert.strictEqual(det.mapping.hakbun, 2); assert.strictEqual(det.mapping.itemCount, 32); assert.deepStrictEqual(det.warnings, []);
  const recs = P.extractStudents(rows, det);
  assert.strictEqual(recs.length, 27);
  assert.strictEqual(recs[0].no, 1); assert.strictEqual(recs[0].grade, 1); assert.ok(recs[0].name && recs[0].name.length >= 2);
  assert.ok(recs[0].items.every(v => Number.isInteger(v) && v >= 1 && v <= 5));
  const v = S.computeVirtues(recs[0].items);
  assert.ok(Q.VIRTUE_KEYS.every(k => v[k] >= 1 && v[k] <= 5));
});

console.log('\n[draft]');
const D = require(path.join(__dirname, '..', 'js', 'draft_logic.js'));
test('computeCosts/makeBudgets: 1~10 크레딧, 예산 합 = 비용 합', () => {
  const costs = D.computeCosts(base, { fitnessWeight: 0.6 });
  const vals = Object.values(costs);
  assert.strictEqual(vals.length, base.length);
  assert.ok(vals.every(c => Number.isInteger(c) && c >= 1 && c <= 10));
  const top = base.slice().sort((a, b) => b.papsPoints - a.papsPoints)[0];
  assert.ok(costs[top.id] >= 7, '체력 최상위는 비싸야 함: ' + costs[top.id]);
  const slots = D.teamSlots(base.length, 6);
  const budgets = D.makeBudgets(costs, base.map(s => s.id), slots);
  assert.strictEqual(budgets.reduce((a, b) => a + b, 0), vals.reduce((a, b) => a + b, 0));
  // 인원이 같은 팀끼리는 예산 차 ≤1, 인원이 많은 팀이 더 큰 예산
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    if (slots[i] === slots[j]) assert.ok(Math.abs(budgets[i] - budgets[j]) <= 1);
    if (slots[i] > slots[j]) assert.ok(budgets[i] >= budgets[j]);
  }
});
test('pick 모드: 풀은 같은 성별·체력 순 K명 묶음, 뱀 순서, 전원 지명, 인원·성별 균형', () => {
  const st = D.initDraft(base, { mode: 'pick', teamCount: 6, genderBalance: true, seed: 3 });
  assert.strictEqual(st.sequence.length, base.length);
  assert.ok(st.pools.every(p => p.length <= 6));
  const byId = {}; base.forEach(s => byId[s.id] = s);
  st.pools.forEach(p => { const gs = new Set(p.map(id => byId[id].gender)); assert.strictEqual(gs.size, 1, '풀은 단일 성별'); });
  // 풀은 같은 성별 체력 상위 2K명 구간 안에서 인성 평균이 비슷한 K명
  const g0 = byId[st.pools[0][0]].gender;
  const band = base.filter(s => s.gender === g0).sort((a, b) => b.papsPoints - a.papsPoints).slice(0, 12).map(s => s.id);
  assert.ok(st.pools[0].every(id => band.includes(id)), '첫 풀은 체력 상위 2K 구간 안');
  const vm = id => ['성실', '협동', '정의', '배려'].reduce((a, k) => a + byId[id].virtues[k], 0) / 4;
  const pool0 = st.pools[0].map(vm), rest = band.filter(id => !st.pools[0].includes(id)).map(vm);
  assert.ok(Math.min(...pool0) >= Math.max(...rest) - 1e-9, '첫 풀은 구간 내 인성 평균 상위');
  let guard = 0;
  while (!D.isDone(st) && guard++ < 100) {
    const c = D.candidates(st, base);
    assert.ok(c.ids.length > 0 && !c.forced);
    const cur = D.currentPick(st);
    assert.ok(c.ids.every(id => st.pools[cur.pool].includes(id)));
    const r = D.pick(st, c.ids[Math.floor(c.ids.length / 2)], base);
    assert.ok(r.ok);
  }
  assert.ok(D.isDone(st) && st.status === 'done');
  const all = st.teams.flat();
  assert.strictEqual(new Set(all).size, base.length);
  const sizes = st.teams.map(t => t.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, sizes);
  for (const g of ['남', '여']) { const c = st.teams.map(t => t.filter(id => byId[id].gender === g).length); assert.ok(Math.max(...c) - Math.min(...c) <= 1, g + c); }
  // 되돌리기
  const before = st.picks.length; assert.ok(D.undo(st)); assert.strictEqual(st.picks.length, before - 1); assert.strictEqual(st.status, 'running');
  assert.strictEqual(D.candidates(st, base).ids.length, 1);
  // 남13·여14·미상1처럼 묶음이 남는 경우에도 팀 인원 차 ≤1
  const odd = base.map((s, i) => Object.assign({}, s, { gender: i === 27 ? null : s.gender }));
  const st2 = D.initDraft(odd, { mode: 'pick', teamCount: 6, genderBalance: true, seed: 9 });
  const sz = st2.slots;
  assert.ok(Math.max(...sz) - Math.min(...sz) <= 1, '슬롯 ' + sz);
  assert.strictEqual(sz.reduce((a, b) => a + b, 0), odd.length);
});
test('credit 모드: 예산 초과 불가, 남은 인원 채울 수 있어야 함, 자동 지명으로 완주', () => {
  const st = D.initDraft(base, { mode: 'credit', teamCount: 6, genderBalance: true, seed: 5, fitnessWeight: 0.6 });
  assert.strictEqual(st.sequence.length, base.length);
  const byId = {}; base.forEach(s => byId[s.id] = s);
  let guard = 0, forced = 0;
  while (!D.isDone(st) && guard++ < 100) {
    const cur = D.currentPick(st);
    const c = D.candidates(st, base);
    assert.ok(c.ids.length > 0, '후보 없음');
    if (c.forced) forced++;
    // 비싼 선수를 고르려는 시도: 예산 넘으면 거부
    const expensive = base.map(s => s.id).filter(id => !st.picks.some(p => p.id === id)).sort((a, b) => st.costs[b] - st.costs[a])[0];
    const left = st.budgets[cur.team] - st.spent[cur.team];
    if (!c.forced && st.costs[expensive] > left) assert.strictEqual(D.pick(st, expensive, base).ok, false);
    const id = D.autoPick(st, base);
    assert.ok(c.ids.includes(id));
    assert.ok(D.pick(st, id, base).ok);
  }
  assert.ok(D.isDone(st));
  for (let t = 0; t < 6; t++) assert.ok(st.spent[t] <= st.budgets[t] || st.picks.some(p => p.team === t && p.forced), '예산 초과 팀 ' + t);
  const sizes = st.teams.map(t => t.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, sizes);
  for (const g of ['남', '여']) { const c = st.teams.map(t => t.filter(id => byId[id].gender === g).length); assert.ok(Math.max(...c) - Math.min(...c) <= 1, g + c); }
  const sm = D.summary(st);
  assert.strictEqual(sm.totalBudget, Object.values(st.costs).reduce((a, b) => a + b, 0));
  console.log('       (강제 지명 ' + forced + '회, 미사용 크레딧 ' + sm.leftover.reduce((a, b) => a + b, 0) + ' / ' + sm.totalBudget + ')');
  assert.ok(forced <= 3, '강제 지명이 너무 잦음: ' + forced);
});
test('auto 모드: 편성 결과를 라운드별 공개 순서로, fillRemaining', () => {
  const r = A.buildTeams(base, { teamCount: 6, seed: 1 });
  const st = D.initDraft(base, { mode: 'auto', teamCount: 6, seed: 1, autoTeams: r.teams });
  assert.strictEqual(st.sequence.length, base.length);
  const first = st.sequence.slice(0, 6).map(s => s.team).sort();
  assert.deepStrictEqual(first, [0, 1, 2, 3, 4, 5]);
  while (!D.isDone(st)) assert.ok(D.pick(st, null, base).ok);
  assert.deepStrictEqual(st.teams.map(t => t.slice().sort()), r.teams.map(t => t.slice().sort()));
  // 성별이 치우친 학급(남 13·여 14·미상 1)도 공개가 막히지 않아야 함
  const odd = base.map((s, i) => Object.assign({}, s, { gender: i === 27 ? null : s.gender }));
  const ro = A.buildTeams(odd, { teamCount: 6, seed: 3, genderBalance: true });
  const so = D.initDraft(odd, { mode: 'auto', teamCount: 6, seed: 3, genderBalance: true, autoTeams: ro.teams });
  let n = 0; while (!D.isDone(so)) { assert.ok(D.pick(so, null, odd).ok, '공개 실패 at ' + n); n++; }
  assert.strictEqual(n, odd.length);
  const st2 = D.initDraft(base, { mode: 'credit', teamCount: 6, seed: 2 });
  D.pick(st2, D.autoPick(st2, base), base);
  D.fillRemaining(st2, base);
  assert.strictEqual(st2.teams.flat().length, base.length); assert.strictEqual(st2.status, 'done');
  const pr = D.profiles(base);
  assert.ok(Object.values(pr).every(p => ['성실형', '협동형', '정의형', '배려형'].includes(p.type) && p.stars >= 1 && p.stars <= 5));
  // 익명 코드: 전원 고유, 출석번호와 무관, 시드 재현
  const an = D.initDraft(base, { mode: 'pick', teamCount: 6, seed: 4, anonymous: true });
  const codes = Object.values(an.codes);
  assert.strictEqual(new Set(codes).size, base.length);
  assert.ok(codes.every(c => /^선수 \d{2}$/.test(c)));
  const an2 = D.initDraft(base, { mode: 'pick', teamCount: 6, seed: 4, anonymous: true });
  assert.deepStrictEqual(an.codes, an2.codes);
  assert.ok(base.some(s => an.codes[s.id] !== '선수 ' + (s.no < 10 ? '0' : '') + s.no), '번호와 달라야 함');
});

test('팀 고정: pick·credit 모드에서 미리 배치, 지명 대상 제외, 인원 균형', () => {
  const pinned = { S1: 0, S2: 0, S5: 3 };
  for (const mode of ['pick', 'credit']) {
    const st = D.initDraft(base, { mode, teamCount: 6, genderBalance: true, seed: 8, pinned });
    assert.deepStrictEqual(st.teams[0].slice().sort(), ['S1', 'S2']); assert.deepStrictEqual(st.teams[3], ['S5']);
    assert.strictEqual(st.sequence.length, base.length - 3, mode + ' 지명 횟수');
    let guard = 0;
    while (!D.isDone(st) && guard++ < 100) {
      const c = D.candidates(st, base);
      assert.ok(!c.ids.includes('S1') && !c.ids.includes('S2') && !c.ids.includes('S5'), '고정 학생은 후보 아님');
      assert.ok(D.pick(st, D.autoPick(st, base), base).ok);
    }
    assert.ok(D.isDone(st));
    assert.strictEqual(new Set(st.teams.flat()).size, base.length, mode + ' 전원 배치');
    const sizes = st.teams.map(t => t.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, mode + ' 인원 ' + sizes);
    assert.ok(st.teams[0].includes('S1') && st.teams[0].includes('S2') && st.teams[3].includes('S5'));
    // 되돌리기는 고정 학생을 빼지 않음
    while (D.undo(st)) {}
    assert.deepStrictEqual(st.teams[0].slice().sort(), ['S1', 'S2']);
    if (mode === 'credit') assert.strictEqual(st.spent[0], st.costs.S1 + st.costs.S2);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
