/* ============================================================
 * scoring.js — 점수 계산 (순수 함수)
 *  - PAPS 원기록 5영역 → 그룹 내 z점수 평균 = papsZ
 *  - PAPS 총점/등급 직접 입력 → z점수
 *  - 인성 32문항 → 4덕목 평균 (8문항 중 5개 이상 응답 시)
 *  - 결측 대체 (papsZ → 0, 덕목 → 학급 평균) + 플래그
 * PAPS와 인성은 절대 합산하지 않는다.
 * ============================================================ */
(function (root) {
  'use strict';

  var Q = root.AgoraQuestions || (typeof require === 'function' ? require('./questions.js') : null);
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

  /* null은 null로 유지. sd=0이면 전원 0 */
  function zScores(arr) {
    var m = mean(arr), s = sd(arr);
    return arr.map(function (v) {
      if (v === null || v === undefined || isNaN(v)) return null;
      if (m === null) return null;
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
  var BMI_LOW = 18.5, BMI_HIGH = 23;

  function bmiValue(height, weight) {
    var h = toNum(height), w = toNum(weight);
    if (h === null || w === null || h <= 0 || w <= 0) return null;
    var hm = h / 100;
    return w / (hm * hm);
  }

  /* 정상범위 안이면 0, 밖이면 -(범위까지 거리). 클수록 좋음 */
  function bmiScore(height, weight) {
    var bmi = bmiValue(height, weight);
    if (bmi === null) return null;
    if (bmi < BMI_LOW) return -(BMI_LOW - bmi);
    if (bmi > BMI_HIGH) return -(bmi - BMI_HIGH);
    return 0;
  }

  /* raw: {run, flex1, flex2, situp, jump1, jump2, height, weight} → 영역별 값 (클수록 좋음) */
  function papsItemValues(raw, includeBmi) {
    if (!raw) return {};
    var out = {
      run: toNum(raw.run),
      flex: best(raw.flex1, raw.flex2),
      situp: toNum(raw.situp),
      jump: best(raw.jump1, raw.jump2)
    };
    if (includeBmi !== false) out.bmi = bmiScore(raw.height, raw.weight);
    return out;
  }

  var PAPS_ITEM_KEYS = ['run', 'flex', 'situp', 'jump', 'bmi'];
  var PAPS_ITEM_LABELS = {
    run: '왕복오래달리기', flex: '앉아윗몸앞으로굽히기', situp: '윗몸말아올리기',
    jump: '제자리멀리뛰기', bmi: '체질량지수(BMI)'
  };

  /* 학생들을 z 그룹으로 나눔. 'auto': 전원 성별 있으면 성별, 아니면 학급 */
  function groupKeyFn(students, zByGender) {
    var mode = zByGender || 'auto';
    if (mode === 'class') return function () { return 'all'; };
    if (mode === 'auto') {
      var allHave = students.length > 0 && students.every(function (s) { return s.gender === '남' || s.gender === '여'; });
      if (!allHave) return function () { return 'all'; };
    }
    return function (s) { return (s.gender === '남' || s.gender === '여') ? s.gender : 'all'; };
  }

  /*
   * students: [{id, gender, papsRaw|null, papsGiven|null}]
   * options: {includeBmi, zByGender, papsGivenType: 'score'|'grade'}
   * 반환: { byId: {id: z|null}, detail: {id: {items:{run:z,...}, used:[keys], group, source}} }
   */
  function computePapsZ(students, options) {
    options = options || {};
    var includeBmi = options.includeBmi !== false;
    var keyOf = groupKeyFn(students, options.zByGender);
    var groups = {};
    students.forEach(function (s) {
      var k = keyOf(s);
      (groups[k] = groups[k] || []).push(s);
    });

    var byId = {}, detail = {};
    Object.keys(groups).forEach(function (gk) {
      var list = groups[gk];
      /* (1) 직접 입력값 (총점 또는 등급) */
      var givenVals = list.map(function (s) {
        var g = toNum(s.papsGiven);
        if (g === null) return null;
        return options.papsGivenType === 'grade' ? -g : g;
      });
      var givenZ = zScores(givenVals);
      /* (2) 원기록 */
      var itemVals = {};
      PAPS_ITEM_KEYS.forEach(function (k) { itemVals[k] = []; });
      list.forEach(function (s) {
        var iv = papsItemValues(s.papsRaw, includeBmi);
        PAPS_ITEM_KEYS.forEach(function (k) { itemVals[k].push(iv[k] === undefined ? null : iv[k]); });
      });
      var itemZ = {};
      PAPS_ITEM_KEYS.forEach(function (k) { itemZ[k] = zScores(itemVals[k]); });

      list.forEach(function (s, i) {
        var d = { items: {}, used: [], group: gk, source: null };
        if (givenZ[i] !== null && givenZ[i] !== undefined) {
          byId[s.id] = givenZ[i];
          d.source = 'given';
        } else {
          var zs = [];
          PAPS_ITEM_KEYS.forEach(function (k) {
            var z = itemZ[k][i];
            if (z !== null && z !== undefined) { zs.push(z); d.items[k] = z; d.used.push(k); }
          });
          byId[s.id] = zs.length ? mean(zs) : null;
          d.source = zs.length ? 'raw' : null;
        }
        detail[s.id] = d;
      });
    });
    return { byId: byId, detail: detail, groupKeys: Object.keys(groups) };
  }

  /* ---------- 인성 ---------- */
  /* items: 길이 32 배열 (1~5 또는 null). 반환 {성실:number|null, ...} */
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

  /* given: {성실, 협동, 정의, 배려} → 검증된 객체 또는 null */
  function virtuesFromGiven(given) {
    var out = {}, any = false;
    VIRTUE_KEYS.forEach(function (k) {
      var x = given ? toNum(given[k]) : null;
      if (x !== null && x >= 1 && x <= 5) { out[k] = x; any = true; } else out[k] = null;
    });
    return any ? out : null;
  }

  /* ---------- 전체 준비 (UI → 알고리즘 입력) ---------- */
  /*
   * students: 세션 학생 배열 [{id, no, name, gender, papsRaw, papsGiven, items, virtuesGiven}]
   * options: {includeBmi, zByGender, papsGivenType}
   * 각 학생에 papsZ, papsDetail, virtues, papsImputed, virtueImputed 를 채운 새 배열 반환
   */
  function prepareStudents(students, options) {
    options = options || {};
    var paps = computePapsZ(students, options);
    var prepared = students.map(function (s) {
      var virt = null;
      if (s.items && s.items.length) virt = computeVirtues(s.items);
      if (!virt || VIRTUE_KEYS.every(function (k) { return virt[k] === null; })) {
        virt = virtuesFromGiven(s.virtuesGiven) || { 성실: null, 협동: null, 정의: null, 배려: null };
      }
      var z = paps.byId[s.id];
      return Object.assign({}, s, {
        papsZ: (z === undefined ? null : z),
        papsDetail: paps.detail[s.id] || null,
        virtues: virt
      });
    });
    /* 결측 대체 */
    var vMeans = {};
    VIRTUE_KEYS.forEach(function (k) {
      var m = mean(prepared.map(function (s) { return s.virtues[k]; }));
      vMeans[k] = m === null ? 3 : m;
    });
    prepared.forEach(function (s) {
      s.papsImputed = (s.papsZ === null);
      if (s.papsImputed) s.papsZ = 0;
      s.virtueImputed = false;
      VIRTUE_KEYS.forEach(function (k) {
        if (s.virtues[k] === null) { s.virtues[k] = vMeans[k]; s.virtueImputed = true; }
      });
    });
    return prepared;
  }

  var api = {
    toNum: toNum, mean: mean, sd: sd, zScores: zScores,
    bmiScore: bmiScore, bmiValue: bmiValue, papsItemValues: papsItemValues,
    PAPS_ITEM_KEYS: PAPS_ITEM_KEYS, PAPS_ITEM_LABELS: PAPS_ITEM_LABELS,
    computePapsZ: computePapsZ, computeVirtues: computeVirtues, virtuesFromGiven: virtuesFromGiven,
    prepareStudents: prepareStudents
  };
  root.AgoraScoring = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
