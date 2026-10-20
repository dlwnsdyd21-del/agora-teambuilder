/* ============================================================
 * scoring.js — 점수 계산 (순수 함수)
 *  - PAPS 원기록 → 종목별 0~20점(공식 기준표, paps_table.js) → 5영역 합계 100점 만점
 *    · 성별·학년 기준표가 없으면 학급 내 상대점수(백분위×20)로 대체하고 표시
 *    · 일부 영역이 없으면 100점 만점으로 환산하고 표시
 *  - PAPS 총점/등급 직접 입력 → 총점 그대로 / 등급은 대표 점수
 *  - 인성 32문항 → 4덕목 평균 (8문항 중 5개 이상 응답 시)
 *  - 결측 대체 (PAPS → 학급 평균, 덕목 → 학급 평균) + 플래그
 * PAPS와 인성은 절대 합산하지 않는다.
 * ============================================================ */
(function (root) {
  'use strict';

  var Q = root.AgoraQuestions || (typeof require === 'function' ? require('./questions.js') : null);
  var T = root.AgoraPapsTable || (typeof require === 'function' ? require('./paps_table.js') : null);
  var VIRTUE_KEYS = Q.VIRTUE_KEYS;

  /* ---------- 기본 통계 ---------- */
  function toNum(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim().replace(/,/g, '');
    if (s === '' || s === '-' || s === '미측정' || s === '결측') return null;
    var m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    var n = parseFloat(m[0]);
    return isFinite(n) ? n : null;
  }
  function mean(arr) {
    var s = 0, n = 0;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v === null || v === undefined || isNaN(v)) continue;
      s += v; n++;
    }
    return n ? s / n : null;
  }
  /* 표본 표준편차 (n-1). n<2 → 0 */
  function sd(arr) {
    var vals = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v === null || v === undefined || isNaN(v)) continue;
      vals.push(v);
    }
    if (vals.length < 2) return 0;
    var m = mean(vals), ss = 0;
    for (var j = 0; j < vals.length; j++) ss += (vals[j] - m) * (vals[j] - m);
    return Math.sqrt(ss / (vals.length - 1));
  }
  function zScores(arr) {
    var m = mean(arr), s = sd(arr);
    return arr.map(function (v) {
      if (v === null || v === undefined || isNaN(v) || m === null) return null;
      return s > 0 ? (v - m) / s : 0;
    });
  }
  function best(a, b) {
    var x = toNum(a), y = toNum(b);
    if (x === null) return y;
    if (y === null) return x;
    return Math.max(x, y);
  }

  /* ---------- PAPS ---------- */
  /* BMI = kg/m², 0.01 단위에서 올림하여 0.1 단위 기록 (공식 기록 규칙) */
  function bmiValue(height, weight) {
    var h = toNum(height), w = toNum(weight);
    if (h === null || w === null || h <= 0 || w <= 0) return null;
    var hm = h / 100;
    return Math.ceil(w / (hm * hm) * 10 - 1e-9) / 10;
  }

  var PAPS_ITEM_KEYS = ['run', 'flex', 'situp', 'pushup', 'grip', 'jump', 'run50', 'bmi'];
  var PAPS_ITEM_LABELS = {};
  PAPS_ITEM_KEYS.forEach(function (k) { PAPS_ITEM_LABELS[k] = T.ITEMS[k].label; });
  var AREA_ITEMS = {
    '심폐지구력': ['run'], '유연성': ['flex'], '근력·근지구력': ['situp', 'pushup', 'grip'],
    '순발력': ['jump', 'run50'], '체지방': ['bmi']
  };
  var AREA_SHORT = { '심폐지구력': '심폐', '유연성': '유연', '근력·근지구력': '근력', '순발력': '순발', '체지방': '체지방' };

  /* raw: {run, flex1, flex2, situp, pushup, grip, jump1, jump2, run50, height, weight, bmi} → 종목별 값 */
  function papsItemValues(raw, includeBmi) {
    if (!raw) return {};
    var out = {
      run: toNum(raw.run), flex: best(raw.flex1, raw.flex2), situp: toNum(raw.situp),
      pushup: toNum(raw.pushup), grip: toNum(raw.grip), jump: best(raw.jump1, raw.jump2), run50: toNum(raw.run50)
    };
    if (includeBmi !== false) {
      var direct = toNum(raw.bmi);
      out.bmi = direct !== null ? direct : bmiValue(raw.height, raw.weight);
    }
    return out;
  }

  var AREA_OF_ITEM = { run: '심폐', flex: '유연', situp: '근력', pushup: '근력', grip: '근력', jump: '순발', run50: '순발', bmi: '체지방' };
  var AREA_FULL = { '심폐': '심폐지구력', '유연': '유연성', '근력': '근력·근지구력', '순발': '순발력', '체지방': '체지방' };

  /*
   * NEIS 영역 점수와 기준표 계산을 대조해 성별(과 학년)을 추정.
   * students: [{id, gender, papsRaw, papsNeis}] → { byId: {id:{gender, gradeKey, matches, compared}}, gradeKey, counts }
   */
  function inferFromNeis(students, options) {
    options = options || {};
    var includeBmi = options.includeBmi !== false;
    var cand = [];
    students.forEach(function (s) {
      if (!s.papsNeis || !s.papsNeis.areas || !s.papsRaw) return;
      var values = papsItemValues(s.papsRaw, includeBmi);
      var keys = ['run', 'flex', 'situp', 'pushup', 'grip', 'jump', 'run50'].filter(function (k) {
        return values[k] !== null && values[k] !== undefined && s.papsNeis.areas[AREA_OF_ITEM[k]] !== undefined;
      });
      if (keys.length < 2) return;
      cand.push({ s: s, values: values, keys: keys });
    });
    function score(c, g, gk) {
      var matches = 0, compared = 0;
      c.keys.forEach(function (k) {
        var r = T.itemPoints(k, c.values[k], g, gk);
        if (!r) return;
        compared++;
        if (r.points === c.s.papsNeis.areas[AREA_OF_ITEM[k]]) matches++;
      });
      return { matches: matches, compared: compared };
    }
    /* 1차: 학년(기준표)을 학급 전체 일치 수로 결정 */
    var gkTotal = {};
    T.GRADE_KEYS.forEach(function (gk) {
      var sum = 0;
      cand.forEach(function (c) { sum += Math.max(score(c, '남', gk).matches, score(c, '여', gk).matches); });
      gkTotal[gk] = sum;
    });
    var gradeKey = null, max = -1, possible = 0;
    cand.forEach(function (c) { possible += c.keys.length; });
    T.GRADE_KEYS.forEach(function (gk) { if (gkTotal[gk] > max) { max = gkTotal[gk]; gradeKey = gk; } });
    /* 2차: 정해진 학년 아래에서 학생별 성별 */
    var byId = {}, genderCount = { 남: 0, 여: 0 }, n = 0;
    if (gradeKey) cand.forEach(function (c) {
      var m = score(c, '남', gradeKey), f = score(c, '여', gradeKey);
      var need = Math.max(2, m.compared - 1);
      var g = null;
      if (m.matches > f.matches && m.matches >= need) g = '남';
      else if (f.matches > m.matches && f.matches >= need) g = '여';
      if (!g) return;
      byId[c.s.id] = { gender: g, gradeKey: gradeKey, matches: g === '남' ? m.matches : f.matches, compared: m.compared };
      genderCount[g]++; n++;
    });
    return { byId: byId, gradeKey: gradeKey, gradeKeyShare: possible ? max / possible : 0, counts: genderCount, inferred: n, candidates: cand.length };
  }

  function gradeKeyFor(student, options) {
    options = options || {};
    var level = options.schoolLevel || '중';
    var g = toNum(student.grade);
    if (g === null || g < 1 || g > 6) g = toNum(options.defaultGrade) || 1;
    return level + Math.round(g);
  }

  /* 영역별로 사용 가능한 종목 하나를 골라 점수화 */
  function areaPoints(values, pointFn) {
    var areas = {}, items = {}, sum = 0, n = 0, missing = [];
    Object.keys(AREA_ITEMS).forEach(function (area) {
      var keys = AREA_ITEMS[area], chosen = null;
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i], v = values[k];
        if (v === null || v === undefined) continue;
        var r = pointFn(k, v);
        if (!r) continue;
        items[k] = { value: v, points: r.points, grade: r.grade, category: r.category || null };
        if (!chosen) chosen = { key: k, points: r.points, grade: r.grade };
      }
      if (chosen) { areas[area] = chosen; sum += chosen.points; n++; }
      else missing.push(area);
    });
    var total = n ? sum * 5 / n : null;
    return { areas: areas, items: items, sum: sum, nAreas: n, total: total, scaled: n > 0 && n < 5, missing: missing };
  }

  /* 학급 내 상대점수: 종목별 백분위 × 20 (기준표가 없는 학생용) */
  function relativePointFn(distributions) {
    return function (k, v) {
      var arr = distributions[k];
      if (!arr || !arr.length) return null;
      var lower = T.ITEMS[k] && T.ITEMS[k].lowerIsBetter;
      var less = 0, eq = 0;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] === v) eq++;
        else if (lower ? arr[i] > v : arr[i] < v) less++;
      }
      var pct = (less + 0.5 * eq) / arr.length;
      var pts = Math.round(pct * 20);
      var grade = pts >= 16 ? 1 : pts >= 12 ? 2 : pts >= 8 ? 3 : pts >= 4 ? 4 : 5;
      return { points: pts, grade: grade };
    };
  }

  var GRADE_REP_POINTS = { 1: 90, 2: 70, 3: 50, 4: 30, 5: 10 };

  /*
   * students: [{id, gender, grade, papsRaw|null, papsGiven|null}]
   * options: {includeBmi, schoolLevel, defaultGrade, papsGivenType:'score'|'grade'}
   * 반환 { byId: {id: 총점|null}, detail: {id: {...}} }
   */
  function computePapsPoints(students, options) {
    options = options || {};
    var includeBmi = options.includeBmi !== false;
    var valuesById = {}, dist = {};
    students.forEach(function (s) {
      var v = papsItemValues(s.papsRaw, includeBmi);
      valuesById[s.id] = v;
      PAPS_ITEM_KEYS.forEach(function (k) {
        if (v[k] !== null && v[k] !== undefined) (dist[k] = dist[k] || []).push(v[k]);
      });
    });
    var relFn = relativePointFn(dist);
    var byId = {}, detail = {};
    students.forEach(function (s) {
      var d = { source: null, gradeKey: null, gender: s.gender || null, areas: {}, items: {}, nAreas: 0, scaled: false, missing: [], total: null };
      var given = toNum(s.papsGiven);
      var neis = s.papsNeis && s.papsNeis.areas ? s.papsNeis.areas : null;
      if (neis && Object.keys(neis).length) {
        /* NEIS 조회 양식: 나이스가 계산한 영역 점수를 그대로 사용 */
        var values0 = valuesById[s.id] || {};
        var sum = 0, n = 0;
        Object.keys(AREA_FULL).forEach(function (a) {
          if (neis[a] === undefined) { d.missing.push(AREA_FULL[a]); return; }
          if (a === '체지방' && !includeBmi) { d.missing.push(AREA_FULL[a]); return; }
          var pts = neis[a];
          var grade = pts >= 16 ? 1 : pts >= 12 ? 2 : pts >= 8 ? 3 : pts >= 4 ? 4 : 5;
          var key = null;
          ['run', 'flex', 'situp', 'pushup', 'grip', 'jump', 'run50', 'bmi'].forEach(function (k) {
            if (!key && AREA_OF_ITEM[k] === a && values0[k] !== null && values0[k] !== undefined) key = k;
          });
          d.areas[AREA_FULL[a]] = { key: key || a, points: pts, grade: grade };
          if (key) d.items[key] = { value: values0[key], points: pts, grade: grade, category: a === '체지방' ? (s.papsNeis.bmiCat || null) : null };
          sum += pts; n++;
        });
        d.nAreas = n;
        d.scaled = n > 0 && n < 5;
        d.total = n ? (n === 5 && given !== null ? Math.max(0, Math.min(100, given)) : sum * 5 / n) : null;
        d.source = 'neis';
        d.gradeKey = gradeKeyFor(s, options);
      } else if (given !== null) {
        if (options.papsGivenType === 'grade') {
          var g = Math.max(1, Math.min(5, Math.round(given)));
          d.total = GRADE_REP_POINTS[g]; d.source = 'grade';
        } else { d.total = Math.max(0, Math.min(100, given)); d.source = 'given'; }
      } else {
        var values = valuesById[s.id];
        var any = PAPS_ITEM_KEYS.some(function (k) { return values[k] !== null && values[k] !== undefined; });
        if (any) {
          var gk = gradeKeyFor(s, options);
          d.gradeKey = gk;
          var gender = (s.gender === '남' || s.gender === '여') ? s.gender : null;
          var r;
          if (gender && T.hasTable(gender, gk)) {
            r = areaPoints(values, function (k, v) { return T.itemPoints(k, v, gender, gk); });
            d.source = 'official';
          } else {
            r = areaPoints(values, relFn);
            d.source = 'relative';
          }
          d.areas = r.areas; d.items = r.items; d.nAreas = r.nAreas; d.scaled = r.scaled; d.missing = r.missing; d.total = r.total;
        }
      }
      d.grade = T.gradeFromTotal(d.total);
      byId[s.id] = d.total;
      detail[s.id] = d;
    });
    return { byId: byId, detail: detail };
  }

  /* ---------- 인성 ---------- */
  function computeVirtues(items) {
    var out = {};
    var minN = Q.MIN_ANSWERED_PER_VIRTUE;
    Q.VIRTUES.forEach(function (v) {
      var vals = [];
      v.items.forEach(function (no) {
        var x = items ? toNum(items[no - 1]) : null;
        if (x !== null && x >= 1 && x <= 5) vals.push(x);
      });
      out[v.key] = vals.length >= minN ? mean(vals) : null;
    });
    return out;
  }
  function virtuesFromGiven(given) {
    var out = {}, any = false;
    VIRTUE_KEYS.forEach(function (k) {
      var x = given ? toNum(given[k]) : null;
      if (x !== null && x >= 1 && x <= 5) { out[k] = x; any = true; } else out[k] = null;
    });
    return any ? out : null;
  }

  /* ---------- 전체 준비 (UI → 알고리즘 입력) ---------- */
  function prepareStudents(students, options) {
    options = options || {};
    var paps = computePapsPoints(students, options);
    var prepared = students.map(function (s) {
      var virt = null;
      if (s.items && s.items.length) virt = computeVirtues(s.items);
      if (!virt || VIRTUE_KEYS.every(function (k) { return virt[k] === null; })) {
        virt = virtuesFromGiven(s.virtuesGiven) || { 성실: null, 협동: null, 정의: null, 배려: null };
      }
      var p = paps.byId[s.id];
      return Object.assign({}, s, {
        papsPoints: (p === undefined ? null : p),
        papsDetail: paps.detail[s.id] || null,
        virtues: virt
      });
    });
    /* 결측 대체 */
    var pMean = mean(prepared.map(function (s) { return s.papsPoints; }));
    if (pMean === null) pMean = 50;
    var vMeans = {};
    VIRTUE_KEYS.forEach(function (k) {
      var m = mean(prepared.map(function (s) { return s.virtues[k]; }));
      vMeans[k] = m === null ? 3 : m;
    });
    prepared.forEach(function (s) {
      s.papsImputed = (s.papsPoints === null);
      if (s.papsImputed) s.papsPoints = pMean;
      s.papsGrade = T.gradeFromTotal(s.papsPoints);
      s.virtueImputed = false;
      VIRTUE_KEYS.forEach(function (k) {
        if (s.virtues[k] === null) { s.virtues[k] = vMeans[k]; s.virtueImputed = true; }
      });
    });
    return prepared;
  }

  var api = {
    toNum: toNum, mean: mean, sd: sd, zScores: zScores, bmiValue: bmiValue, papsItemValues: papsItemValues,
    PAPS_ITEM_KEYS: PAPS_ITEM_KEYS, PAPS_ITEM_LABELS: PAPS_ITEM_LABELS, AREA_ITEMS: AREA_ITEMS, AREA_SHORT: AREA_SHORT,
    gradeKeyFor: gradeKeyFor, computePapsPoints: computePapsPoints, inferFromNeis: inferFromNeis,
    computeVirtues: computeVirtues, virtuesFromGiven: virtuesFromGiven, prepareStudents: prepareStudents
  };
  root.AgoraScoring = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
