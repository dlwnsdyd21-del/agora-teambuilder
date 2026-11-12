/* ============================================================
 * algorithm.js — 팀 편성 (순수 함수, 시드 재현 가능)
 *  1차: PAPS 서펜타인 드래프트 (성별 그룹별) → 팀 평균 PAPS 균등
 *  2차: 교환/이동 지역 탐색 → PAPS 범위를 허용편차(τ) 안에 유지하며
 *       4덕목(성실·협동·정의·배려) 팀 평균 편차 최소화
 *  J = 1000·max(0, Dp−τ) + Dc + 0.01·Dp   (PAPS·인성 합산 없음)
 * ============================================================ */
(function (root) {
  'use strict';

  var Q = root.AgoraQuestions || (typeof require === 'function' ? require('./questions.js') : null);
  var VK = Q.VIRTUE_KEYS;
  var GENDERS = ['남', '여', '미상'];

  /* ---------- 시드 PRNG ---------- */
  function mulberry32(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function gKey(g) { return g === '남' || g === '여' ? g : '미상'; }
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function sdSample(a) {
    if (a.length < 2) return 0;
    var m = mean(a), ss = 0;
    for (var i = 0; i < a.length; i++) ss += (a[i] - m) * (a[i] - m);
    return Math.sqrt(ss / (a.length - 1));
  }

  /* ---------- 정규화된 학생 입력 ---------- */
  function normalizeStudents(students) {
    var vMeans = {};
    VK.forEach(function (k) {
      var vals = students.map(function (s) { return s.virtues && typeof s.virtues[k] === 'number' ? s.virtues[k] : null; })
        .filter(function (v) { return v !== null && !isNaN(v); });
      vMeans[k] = vals.length ? mean(vals) : 3;
    });
    return students.map(function (s, idx) {
      var v = {};
      VK.forEach(function (k) {
        var x = s.virtues ? s.virtues[k] : null;
        v[k] = (typeof x === 'number' && !isNaN(x)) ? x : vMeans[k];
      });
      var p = (typeof s.papsPoints === 'number' && !isNaN(s.papsPoints)) ? s.papsPoints
        : (typeof s.papsZ === 'number' && !isNaN(s.papsZ)) ? s.papsZ : null;
      return { id: s.id, idx: idx, name: s.name, g: gKey(s.gender), p: p, v: v };
    }).map(function (s, _, arr) {
      if (s.p === null) {
        var ps = arr.map(function (x) { return x.p; }).filter(function (x) { return x !== null; });
        s.p = ps.length ? mean(ps) : 0;
      }
      return s;
    });
  }

  /* ---------- 팀 크기·성별 쿼터 ---------- */
  function teamSizes(N, K, rng) {
    var base = Math.floor(N / K), extra = N % K;
    var order = shuffle(Array.from({ length: K }, function (_, i) { return i; }), rng);
    var sizes = new Array(K).fill(base);
    for (var i = 0; i < extra; i++) sizes[order[i]]++;
    return sizes;
  }

  /* 그룹별 쿼터: 남은 용량이 큰 팀부터 추가 1명 배정 (팀별 차 ≤1 유지) */
  function genderQuotas(sizes, counts, rng) {
    var K = sizes.length;
    var remaining = sizes.slice();
    var quotas = {};
    GENDERS.forEach(function (g) {
      var n = counts[g] || 0;
      var base = Math.floor(n / K), extra = n % K;
      var q = new Array(K).fill(base);
      var order = Array.from({ length: K }, function (_, i) { return i; });
      shuffle(order, rng);
      order.sort(function (a, b) { return remaining[b] - remaining[a]; });
      for (var i = 0; i < extra; i++) q[order[i]]++;
      for (var t = 0; t < K; t++) remaining[t] -= q[t];
      quotas[g] = q;
    });
    return quotas;
  }

  /* ---------- 상태 (팀별 합계) ---------- */
  function State(students, K) {
    this.S = students; this.K = K;
    this.team = new Array(students.length).fill(-1);
    this.members = Array.from({ length: K }, function () { return []; });
    this.cnt = Array.from({ length: K }, function () { return { 남: 0, 여: 0, 미상: 0 }; });
    this.sumP = new Array(K).fill(0);
    this.sumV = Array.from({ length: K }, function () { var o = {}; VK.forEach(function (k) { o[k] = 0; }); return o; });
  }
  State.prototype.add = function (i, t) {
    var s = this.S[i];
    this.team[i] = t; this.members[t].push(i); this.cnt[t][s.g]++; this.sumP[t] += s.p;
    for (var k = 0; k < VK.length; k++) this.sumV[t][VK[k]] += s.v[VK[k]];
  };
  State.prototype.remove = function (i) {
    var s = this.S[i], t = this.team[i];
    this.team[i] = -1;
    this.members[t].splice(this.members[t].indexOf(i), 1);
    this.cnt[t][s.g]--; this.sumP[t] -= s.p;
    for (var k = 0; k < VK.length; k++) this.sumV[t][VK[k]] -= s.v[VK[k]];
  };
  State.prototype.move = function (i, t) { this.remove(i); this.add(i, t); };
  State.prototype.swap = function (i, j) {
    var ti = this.team[i], tj = this.team[j];
    this.remove(i); this.remove(j); this.add(i, tj); this.add(j, ti);
  };
  State.prototype.size = function (t) { return this.members[t].length; };

  /* ---------- 목적함수 ---------- */
  function spreads(st, studentSd) {
    var K = st.K, pm = [], vm = {};
    VK.forEach(function (k) { vm[k] = []; });
    for (var t = 0; t < K; t++) {
      var n = st.size(t) || 1;
      pm.push(st.sumP[t] / n);
      for (var k = 0; k < VK.length; k++) vm[VK[k]].push(st.sumV[t][VK[k]] / n);
    }
    var Dp = Math.max.apply(null, pm) - Math.min.apply(null, pm);
    var Dc = 0, ratios = {};
    VK.forEach(function (k) {
      var r = studentSd[k] > 1e-9 ? sdSample(vm[k]) / studentSd[k] : 0;
      ratios[k] = r; Dc += r;
    });
    return { Dp: Dp, Dc: Dc, ratios: ratios, teamMeansP: pm, teamMeansV: vm };
  }
  /* Dp는 점수 단위(0~100)이므로 1000·초과분으로 강한 제약, 0.01·Dp로 약한 선호 */
  function objective(sp, tau) {
    return 1000 * Math.max(0, sp.Dp - tau) + sp.Dc + 0.01 * sp.Dp;
  }

  /* ---------- 제약 ---------- */
  function buildConstraints(students, options) {
    var idToIdx = {};
    students.forEach(function (s) { idToIdx[String(s.id)] = s.idx; });
    var n = students.length;
    var unit = Array.from({ length: n }, function (_, i) { return i; }); // union-find
    function find(x) { while (unit[x] !== x) { unit[x] = unit[unit[x]]; x = unit[x]; } return x; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) unit[a] = b; }
    var log = [];
    (options.together || []).forEach(function (pr) {
      var a = idToIdx[String(pr[0])], b = idToIdx[String(pr[1])];
      if (a === undefined || b === undefined) { log.push('함께 제약에 없는 학생이 있어 무시했습니다: ' + pr.join(', ')); return; }
      union(a, b);
    });
    var unitOf = students.map(function (_, i) { return find(i); });
    var unitMembers = {};
    students.forEach(function (_, i) { (unitMembers[unitOf[i]] = unitMembers[unitOf[i]] || []).push(i); });
    var inUnit = students.map(function (_, i) { return unitMembers[unitOf[i]].length > 1; });

    var apart = students.map(function () { return []; });
    (options.apart || []).forEach(function (pr) {
      var a = idToIdx[String(pr[0])], b = idToIdx[String(pr[1])];
      if (a === undefined || b === undefined) { log.push('분리 제약에 없는 학생이 있어 무시했습니다: ' + pr.join(', ')); return; }
      if (unitOf[a] === unitOf[b]) { log.push('함께·분리 제약이 충돌합니다: ' + pr.join(', ') + ' (분리 무시)'); return; }
      apart[a].push(b); apart[b].push(a);
    });

    var pinned = new Array(n).fill(-1);
    var pinMap = options.pinned || {};
    Object.keys(pinMap).forEach(function (id) {
      var i = idToIdx[String(id)], t = parseInt(pinMap[id], 10);
      if (i === undefined || isNaN(t) || t < 0 || t >= options.teamCount) return;
      pinned[i] = t;
    });
    /* 같은 단위(함께) 안에 서로 다른 팀으로 고정되면 충돌 */
    Object.keys(unitMembers).forEach(function (u) {
      var ms = unitMembers[u], t = -1;
      ms.forEach(function (i) {
        if (pinned[i] < 0) return;
        if (t < 0) t = pinned[i];
        else if (t !== pinned[i]) { log.push('함께 제약 학생들이 서로 다른 팀에 고정되어 있어 고정을 무시했습니다.'); pinned[i] = -1; }
      });
      if (t >= 0) ms.forEach(function (i) { if (pinned[i] < 0) pinned[i] = t; });
    });
    return { unitOf: unitOf, unitMembers: unitMembers, inUnit: inUnit, apart: apart, pinned: pinned, log: log };
  }

  function apartViolations(st, C, i, t) {
    var a = C.apart[i], c = 0;
    for (var k = 0; k < a.length; k++) if (a[k] !== i && st.team[a[k]] === t) c++;
    return c;
  }
  function totalApartViolations(st, C) {
    var c = 0;
    for (var i = 0; i < st.S.length; i++) c += apartViolations(st, C, i, st.team[i]);
    return c / 2;
  }

  /* ---------- 새로운 조합: 이전 편성에서 같은 팀이었던 짝 ---------- */
  /* 새 조합을 위해 허용하는 인성 편차 지수(Dc) 여유. 샘플 30명·6팀 기준: 시드만 바꾸면 60쌍 중 평균 12쌍이 다시 같은 팀,
   * 여유 0.2 → 약 6쌍, 0.3 → 약 4쌍, 0.6 → 약 2쌍(대신 덕목 팀 평균 차이가 두 배 이상). PAPS 허용편차는 항상 지킴 */
  var MIX_SLACK = 0.3;
  /* avoid: [[[ids]]] 이전 편성들(최근 것이 앞). 반환: 짝 가중치 행렬(최근 1, 그 전 0.5, …) 또는 null */
  function pairWeights(students, avoid) {
    var n = students.length, idToIdx = {}, any = false;
    students.forEach(function (s) { idToIdx[String(s.id)] = s.idx; });
    var W = Array.from({ length: n }, function () { return new Float64Array(n); });
    (avoid || []).forEach(function (teams, hIdx) {
      var w = Math.pow(0.5, hIdx);
      (teams || []).forEach(function (ids) {
        var idx = (ids || []).map(function (id) { return idToIdx[String(id)]; }).filter(function (i) { return i !== undefined; });
        for (var a = 0; a < idx.length; a++) for (var b = a + 1; b < idx.length; b++) {
          if (idx[a] === idx[b]) continue;
          W[idx[a]][idx[b]] += w; W[idx[b]][idx[a]] += w; any = true;
        }
      });
    });
    return any ? W : null;
  }
  /* 같은 팀 짝 가운데 예전에도 같은 팀이었던 짝의 비율(가중) */
  function repeatScore(st, W) {
    var sum = 0, pairs = 0;
    for (var t = 0; t < st.K; t++) {
      var ms = st.members[t];
      pairs += ms.length * (ms.length - 1) / 2;
      for (var a = 0; a < ms.length; a++) { var row = W[ms[a]]; for (var b = a + 1; b < ms.length; b++) sum += row[ms[b]]; }
    }
    return pairs ? sum / pairs : 0;
  }
  /* 두 편성에서 모두 같은 팀인 짝의 수. 반환 {shared, total(teamsB 의 같은 팀 짝 수)} */
  function sharedPairs(teamsA, teamsB) {
    var teamOf = {};
    (teamsA || []).forEach(function (ids, t) { (ids || []).forEach(function (id) { teamOf[String(id)] = t; }); });
    var shared = 0, total = 0;
    (teamsB || []).forEach(function (ids) {
      for (var a = 0; a < ids.length; a++) for (var b = a + 1; b < ids.length; b++) {
        total++;
        var ta = teamOf[String(ids[a])], tb = teamOf[String(ids[b])];
        if (ta !== undefined && ta === tb) shared++;
      }
    });
    return { shared: shared, total: total };
  }

  /* ---------- 1차: 서펜타인 드래프트 ---------- */
  /* noise: 새로운 조합용 — PAPS 정렬 기준에 ±noise 점의 무작위 흔들림을 줘 출발 배치를 다양하게 */
  function draft(students, K, C, quotas, sizes, rng, genderBalance, noise) {
    var st = new State(students, K);
    var room = {};  // room[g][t] 남은 성별 쿼터
    GENDERS.forEach(function (g) { room[g] = quotas[g].slice(); });
    var totalRoom = sizes.slice();

    function take(g, t) {
      /* 고정 학생: 쿼터가 없으면 같은 그룹에서 가장 여유 있는 팀의 쿼터를 끌어옴 */
      if (genderBalance && room[g][t] <= 0) {
        var best = -1;
        for (var u = 0; u < K; u++) if (u !== t && room[g][u] > 0 && (best < 0 || room[g][u] > room[g][best])) best = u;
        if (best >= 0) { room[g][best]--; totalRoom[best]--; totalRoom[t]++; room[g][t]++; }
      } else if (!genderBalance && totalRoom[t] <= 0) {
        var b2 = -1;
        for (var u2 = 0; u2 < K; u2++) if (u2 !== t && totalRoom[u2] > 0 && (b2 < 0 || totalRoom[u2] > totalRoom[b2])) b2 = u2;
        if (b2 >= 0) { totalRoom[b2]--; totalRoom[t]++; }
      }
      if (genderBalance) room[g][t]--;
      totalRoom[t]--;
    }

    /* 고정 학생 먼저 */
    for (var i = 0; i < students.length; i++) {
      if (C.pinned[i] >= 0) { take(students[i].g, C.pinned[i]); st.add(i, C.pinned[i]); }
    }
    /* 성별 그룹별 서펜타인 (성별 균형 꺼져 있으면 한 그룹) */
    var groups = genderBalance ? GENDERS : ['all'];
    var offset = Math.floor(rng() * K);
    groups.forEach(function (g) {
      var list = [];
      for (var i = 0; i < students.length; i++) {
        if (st.team[i] >= 0) continue;
        if (genderBalance && students[i].g !== g) continue;
        list.push(i);
      }
      if (!list.length) return;
      /* PAPS 내림차순, 동점은 시드 랜덤 */
      var jitter = {}, key = {};
      list.forEach(function (i) { jitter[i] = rng(); key[i] = students[i].p + (noise ? (rng() * 2 - 1) * noise : 0); });
      list.sort(function (a, b) { return (key[b] - key[a]) || (jitter[a] - jitter[b]); });
      var order = [];
      for (var t = 0; t < K; t++) order.push((t + offset) % K);
      var pos = 0, dir = 1;
      list.forEach(function (i) {
        var placed = false, tries = 0;
        while (!placed && tries < 2 * K + 2) {
          var t = order[pos];
          var ok = genderBalance ? room[students[i].g][t] > 0 : totalRoom[t] > 0;
          if (ok) {
            if (genderBalance) room[students[i].g][t]--;
            totalRoom[t]--;
            st.add(i, t); placed = true;
          }
          pos += dir;
          if (pos >= K) { pos = K - 1; dir = -1; } else if (pos < 0) { pos = 0; dir = 1; }
          tries++;
        }
        if (!placed) { // 쿼터가 꼬인 경우: 가장 여유 있는 팀 (성별 장부도 함께 차감)
          var bt = 0;
          for (var u = 1; u < K; u++) if (totalRoom[u] > totalRoom[bt]) bt = u;
          totalRoom[bt]--; if (genderBalance) room[students[i].g][bt]--;
          st.add(i, bt);
        }
      });
      offset = (offset + 1) % K;
    });
    return st;
  }

  /* ---------- 제약 보수: 함께 → 분리 ---------- */
  function sameGroupSwapCandidate(st, students, C, i, targetTeam, genderBalance, allowedUnit) {
    var ms = st.members[targetTeam];
    var best = -1;
    for (var k = 0; k < ms.length; k++) {
      var j = ms[k];
      if (C.pinned[j] >= 0) continue;
      if (C.inUnit[j] && C.unitOf[j] !== allowedUnit) continue;
      if (genderBalance && students[j].g !== students[i].g) continue;
      if (best < 0 || Math.abs(students[j].p - students[i].p) < Math.abs(students[best].p - students[i].p)) best = j;
    }
    return best;
  }

  function repairTogether(st, students, C, genderBalance, log) {
    Object.keys(C.unitMembers).forEach(function (u) {
      var ms = C.unitMembers[u];
      if (ms.length < 2) return;
      var target = -1;
      ms.forEach(function (i) { if (C.pinned[i] >= 0) target = C.pinned[i]; });
      if (target < 0) target = st.team[ms[0]];
      ms.forEach(function (i) {
        if (st.team[i] === target) return;
        var j = sameGroupSwapCandidate(st, students, C, i, target, genderBalance, -1);
        if (j >= 0) st.swap(i, j);
        else {
          st.move(i, target);
          log.push('함께 제약을 지키기 위해 팀 인원이 1명 달라졌습니다: ' + (students[i].name || students[i].id));
        }
      });
    });
  }

  function repairApart(st, students, C, genderBalance, log) {
    for (var pass = 0; pass < 3; pass++) {
      var changed = false;
      for (var i = 0; i < students.length; i++) {
        if (apartViolations(st, C, i, st.team[i]) === 0) continue;
        if (C.pinned[i] >= 0 || C.inUnit[i]) continue;
        var bestT = -1, bestJ = -1, bestScore = Infinity;
        for (var t = 0; t < st.K; t++) {
          if (t === st.team[i]) continue;
          if (apartViolations(st, C, i, t) > 0) continue;
          var j = sameGroupSwapCandidate(st, students, C, i, t, genderBalance, -1);
          if (j < 0) continue;
          if (apartViolations(st, C, j, st.team[i]) > 0) continue;
          var sc = Math.abs(students[j].p - students[i].p);
          if (sc < bestScore) { bestScore = sc; bestT = t; bestJ = j; }
        }
        if (bestJ >= 0) { st.swap(i, bestJ); changed = true; }
      }
      if (!changed) break;
    }
    var left = totalApartViolations(st, C);
    if (left > 0) log.push('분리 제약 ' + left + '건을 만족하는 배치를 찾지 못했습니다. 수동으로 조정해 주세요.');
  }

  /* ---------- 2차: 지역 탐색 ---------- */
  function sizeBounds(N, K, counts, genderBalance) {
    var b = { min: Math.floor(N / K), max: Math.ceil(N / K), g: {} };
    GENDERS.forEach(function (g) {
      var n = counts[g] || 0;
      b.g[g] = genderBalance ? { min: Math.floor(n / K), max: Math.ceil(n / K) } : { min: 0, max: Infinity };
    });
    return b;
  }

  function localSearch(st, students, C, options, studentSd, rng, bounds) {
    var tau = options.papsTolerance, maxEvals = options.maxEvals || 20000;
    var gb = options.genderBalance;
    var n = students.length;
    /* mix = {W, dcCap}: 새로운 조합 — PAPS 허용편차와 인성 편차 상한(dcCap) 안에서, 예전에 같은 팀이었던 짝을 최소화 */
    var mix = options.mix || null;
    function cost(sp) {
      if (!mix) return objective(sp, tau);
      return 1000 * Math.max(0, sp.Dp - tau) + 100 * Math.max(0, sp.Dc - mix.dcCap) + repeatScore(st, mix.W) + 0.1 * sp.Dc + 0.01 * sp.Dp;
    }
    var cur = spreads(st, studentSd), J = cost(cur);
    var evals = 0, improved = true, rounds = 0;

    function swapOk(i, j) {
      if (st.team[i] === st.team[j]) return false;
      if (C.pinned[i] >= 0 || C.pinned[j] >= 0) return false;
      if (C.inUnit[i] || C.inUnit[j]) return false;
      if (gb && students[i].g !== students[j].g) return false;
      if (apartViolations(st, C, i, st.team[j]) > 0 || apartViolations(st, C, j, st.team[i]) > 0) return false;
      return true;
    }
    function moveOk(i, t) {
      var from = st.team[i];
      if (from === t) return false;
      if (C.pinned[i] >= 0 || C.inUnit[i]) return false;
      if (st.size(from) - 1 < bounds.min || st.size(t) + 1 > bounds.max) return false;
      var g = students[i].g;
      if (st.cnt[from][g] - 1 < bounds.g[g].min || st.cnt[t][g] + 1 > bounds.g[g].max) return false;
      if (apartViolations(st, C, i, t) > 0) return false;
      return true;
    }

    while (improved && evals < maxEvals) {
      improved = false; rounds++;
      var pairs = [];
      for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) pairs.push([i, j]);
      shuffle(pairs, rng);
      for (var p = 0; p < pairs.length && evals < maxEvals; p++) {
        var a = pairs[p][0], b = pairs[p][1];
        if (!swapOk(a, b)) continue;
        st.swap(a, b); evals++;
        var sp = spreads(st, studentSd), Jn = cost(sp);
        if (Jn < J - 1e-12) { J = Jn; cur = sp; improved = true; }
        else st.swap(a, b);
      }
      /* 단일 이동 (팀 크기 범위 안에서) */
      var ids = shuffle(Array.from({ length: n }, function (_, i) { return i; }), rng);
      for (var q = 0; q < ids.length && evals < maxEvals; q++) {
        var s = ids[q];
        for (var t = 0; t < st.K; t++) {
          var from = st.team[s];
          if (!moveOk(s, t)) continue;
          st.move(s, t); evals++;
          var sp2 = spreads(st, studentSd), J2 = cost(sp2);
          if (J2 < J - 1e-12) { J = J2; cur = sp2; improved = true; }
          else st.move(s, from);
        }
      }
    }
    return { J: J, spreads: cur, evals: evals, rounds: rounds };
  }

  /* ---------- 통계 ---------- */
  function computeStats(st, students, studentSd) {
    var sp = spreads(st, studentSd);
    var teams = [];
    for (var t = 0; t < st.K; t++) {
      var n = st.size(t) || 1;
      var mv = {};
      VK.forEach(function (k) { mv[k] = st.sumV[t][k] / n; });
      teams.push({
        index: t, size: st.size(t),
        male: st.cnt[t]['남'], female: st.cnt[t]['여'], unknown: st.cnt[t]['미상'],
        meanPaps: st.sumP[t] / n, meanVirtues: mv,
        memberIds: st.members[t].slice().sort(function (a, b) { return students[b].p - students[a].p; }).map(function (i) { return students[i].id; })
      });
    }
    var metrics = { PAPS: { teamMeans: sp.teamMeansP, range: sp.Dp, sd: sdSample(sp.teamMeansP), studentSd: studentSd.PAPS } };
    VK.forEach(function (k) {
      var tm = sp.teamMeansV[k];
      metrics[k] = { teamMeans: tm, range: Math.max.apply(null, tm) - Math.min.apply(null, tm), sd: sdSample(tm), studentSd: studentSd[k], ratio: sp.ratios[k] };
    });
    /* PAPS 범위는 학생 표준편차 대비(척도 무관), 인성은 4덕목 비율의 평균(각 덕목 팀평균 SD ÷ 학생 SD)
     * → 두 항 모두 "1 = 학생 개인차만큼 팀이 다르다"에서 만점 감점 */
    var pRel = studentSd.PAPS > 1e-9 ? sp.Dp / studentSd.PAPS : 0;
    var cRel = sp.Dc / VK.length;
    var equity = Math.round(100 * (1 - 0.5 * Math.min(1, pRel) - 0.5 * Math.min(1, cRel)));
    return { teams: teams, metrics: metrics, Dp: sp.Dp, Dc: sp.Dc, equity: Math.max(0, Math.min(100, equity)) };
  }

  function studentSds(students) {
    var o = { PAPS: sdSample(students.map(function (s) { return s.p; })) };
    VK.forEach(function (k) { o[k] = sdSample(students.map(function (s) { return s.v[k]; })); });
    return o;
  }

  /* ---------- 공개 API ---------- */
  /* papsTolerance: 팀 평균 PAPS 총점(100점 만점)의 최대-최소 허용 범위(점). 1점 이하는 팀 수가 많을 때 못 지킬 수 있음 */
  var DEFAULTS = { teamCount: 6, genderBalance: true, papsTolerance: 3, seed: 1, restarts: 5, maxEvals: 20000, together: [], apart: [], pinned: {} };

  /*
   * students: [{id, name, gender, papsPoints(0~100), virtues:{성실,협동,정의,배려}}]
   * 반환: { teams:[[ids]], stats, equity, seed, log, meta }
   */
  function buildTeams(inputStudents, options) {
    if (options && options.genderSeparate) return buildTeamsSeparate(inputStudents, options);
    options = Object.assign({}, DEFAULTS, options || {});
    var log = [];
    var K = Math.max(1, Math.floor(options.teamCount || 1));
    var students = normalizeStudents(inputStudents || []);
    var N = students.length;
    if (N === 0) return { teams: Array.from({ length: K }, function () { return []; }), stats: null, equity: 0, seed: options.seed, log: ['학생이 없습니다.'] };
    if (N < 2 * K) log.push('학생 수(' + N + ')가 팀 수의 2배보다 적어 팀당 인원이 매우 적습니다.');
    var impP = (inputStudents || []).filter(function (s) { return s.papsImputed; }).length;
    var impV = (inputStudents || []).filter(function (s) { return s.virtueImputed; }).length;
    if (impP || impV) log.push('자료가 없어 학급 평균으로 채운 학생: PAPS ' + impP + '명 · 인성 ' + impV + '명 (균형 수치가 실제보다 좋게 보일 수 있음)');
    var C = buildConstraints(students, options);
    log = log.concat(C.log);
    var counts = { 남: 0, 여: 0, 미상: 0 };
    students.forEach(function (s) { counts[s.g]++; });
    var genderBalance = !!options.genderBalance && (counts['남'] + counts['여']) > 0;
    if (genderBalance && counts['미상'] > 0) log.push('성별 미상 학생 ' + counts['미상'] + '명은 별도 그룹으로 균등 배분했습니다.');
    var studentSd = studentSds(students);
    var bounds = sizeBounds(N, K, counts, genderBalance);

    var best = null;
    var restarts = Math.max(1, options.restarts | 0);
    for (var r = 0; r < restarts; r++) {
      var rng = mulberry32((options.seed | 0) * 7919 + r * 104729 + 17);
      var sizes = teamSizes(N, K, rng);
      var quotas = genderBalance ? genderQuotas(sizes, counts, rng)
        : { 남: new Array(K).fill(0), 여: new Array(K).fill(0), 미상: new Array(K).fill(0) };
      var st = draft(students, K, C, quotas, sizes, rng, genderBalance);
      var rlog = [];
      repairTogether(st, students, C, genderBalance, rlog);
      repairApart(st, students, C, genderBalance, rlog);
      var ls = localSearch(st, students, C, { papsTolerance: options.papsTolerance, genderBalance: genderBalance, maxEvals: options.maxEvals }, studentSd, rng, bounds);
      var viol = totalApartViolations(st, C);
      var score = ls.J + viol * 1e6;
      if (!best || score < best.score) best = { score: score, st: st, ls: ls, rlog: rlog };
    }
    /*
     * 새로운 조합(options.avoid = 이전 편성들): 위에서 구한 가장 균형 잡힌 편성을 기준으로,
     * PAPS 범위는 허용편차 안(기준 편성이 못 지켰으면 그 수준), 인성 편차는 기준 + MIX_SLACK 안에서
     * 예전에 같은 팀이었던 짝이 가장 적은 편성을 다시 찾는다.
     */
    var mixMeta = null;
    var W = N > K ? pairWeights(students, options.avoid) : null;
    if (W) {
      var base = best.ls.spreads;
      var mix = { W: W, dcCap: base.Dc + (typeof options.mixSlack === 'number' ? options.mixSlack : MIX_SLACK) };
      var tauMix = Math.max(Number(options.papsTolerance) || 0, base.Dp);
      var noise = 0.75 * (studentSd.PAPS || 0);
      var baseRepeat = repeatScore(best.st, W), bestMix = null;
      for (var r2 = 0; r2 < restarts; r2++) {
        var rng2 = mulberry32((options.seed | 0) * 15485863 + r2 * 32452843 + 101);
        var sizes2 = teamSizes(N, K, rng2);
        var quotas2 = genderBalance ? genderQuotas(sizes2, counts, rng2)
          : { 남: new Array(K).fill(0), 여: new Array(K).fill(0), 미상: new Array(K).fill(0) };
        var st2 = draft(students, K, C, quotas2, sizes2, rng2, genderBalance, noise);
        var rlog2 = [];
        repairTogether(st2, students, C, genderBalance, rlog2);
        repairApart(st2, students, C, genderBalance, rlog2);
        var ls2 = localSearch(st2, students, C, { papsTolerance: tauMix, genderBalance: genderBalance, maxEvals: options.maxEvals, mix: mix }, studentSd, rng2, bounds);
        var score2 = ls2.J + totalApartViolations(st2, C) * 1e6;
        if (!bestMix || score2 < bestMix.score) bestMix = { score: score2, st: st2, ls: ls2, rlog: rlog2 };
      }
      mixMeta = { repeat: repeatScore(bestMix.st, W), baseRepeat: baseRepeat, baseDc: base.Dc, baseDp: base.Dp, dcCap: mix.dcCap };
      best = bestMix;
    }
    log = log.concat(best.rlog);
    var stats = computeStats(best.st, students, studentSd);
    var teams = best.st.members.map(function (ms) {
      return ms.slice().sort(function (a, b) { return students[b].p - students[a].p; }).map(function (i) { return students[i].id; });
    });
    return {
      teams: teams, stats: stats, equity: stats.equity, seed: options.seed, log: log,
      meta: { evals: best.ls.evals, rounds: best.ls.rounds, J: best.ls.J, restarts: restarts, genderBalance: genderBalance, mix: mixMeta }
    };
  }

  /* ---------- 남녀 따로 편성 (남자 팀 Km개 + 여자 팀 Kf개) ---------- */
  /* 팀 번호 t 의 기본 이름: 보통 "1팀", 남녀 따로면 "남 1팀"/"여 1팀" */
  function teamLabel(t, split) {
    if (split && (split['남'] | 0) + (split['여'] | 0) > 0) {
      var Km = split['남'] | 0;
      return t < Km ? '남 ' + (t + 1) + '팀' : '여 ' + (t - Km + 1) + '팀';
    }
    return (t + 1) + '팀';
  }
  /*
   * 남녀 따로: 남학생은 teamCountM 개, 여학생은 teamCountF 개 팀으로 각각 buildTeams.
   * 팀 번호 0..Km-1 = 남자 팀, Km.. = 여자 팀. 고정·함께·떨어뜨리기는 같은 성별 안에서만 적용.
   * 반환은 buildTeams 와 같되 stats 대신 groups(성별 그룹별 통계), meta.separate = {남:Km, 여:Kf}
   */
  function buildTeamsSeparate(inputStudents, options) {
    var opts = Object.assign({}, DEFAULTS, options || {}, { genderSeparate: false });
    var Km = Math.max(1, Math.floor(opts.teamCountM || 1)), Kf = Math.max(1, Math.floor(opts.teamCountF || 1));
    var log = [], boys = [], girls = [], unknown = [];
    (inputStudents || []).forEach(function (s) { var g = gKey(s.gender); (g === '남' ? boys : g === '여' ? girls : unknown).push(s); });
    if (unknown.length) {
      log.push('성별 미상 ' + unknown.length + '명은 인원이 많은 쪽(' + (boys.length >= girls.length ? '남자' : '여자') + ' 팀)에 넣었습니다. 명단에서 성별을 채우면 정확해집니다.');
      (boys.length >= girls.length ? boys : girls).push.apply(boys.length >= girls.length ? boys : girls, unknown);
    }
    var nameOf = function (id) { var s = (inputStudents || []).find(function (x) { return String(x.id) === String(id); }); return s ? ((s.no !== null && s.no !== undefined ? s.no + ' ' : '') + (s.name || id)) : id; };
    function sub(list, K, offset, label) {
      var ids = {}; list.forEach(function (s) { ids[s.id] = true; });
      var pinned = {};
      Object.keys(opts.pinned || {}).forEach(function (id) {
        if (!ids[id]) return;
        var t = parseInt(opts.pinned[id], 10);
        if (t >= offset && t < offset + K) pinned[id] = t - offset;
        else log.push(label + ': ' + nameOf(id) + ' 학생의 고정 팀(' + teamLabel(t, { 남: Km, 여: Kf }) + ')이 성별과 맞지 않아 고정을 무시했습니다.');
      });
      var pairs = function (key, word) {
        return (opts[key] || []).filter(function (pr) {
          var a = ids[pr[0]], b = ids[pr[1]];
          if (a && b) return true;
          if (a && !b) log.push(nameOf(pr[0]) + ' · ' + nameOf(pr[1]) + ' ' + word + ' 조건은 성별이 달라 적용할 수 없습니다.');
          return false;
        });
      };
      var o = Object.assign({}, opts, { teamCount: K, genderBalance: false, pinned: pinned, together: pairs('together', '함께 넣기'), apart: pairs('apart', '떨어뜨리기') });
      var res = buildTeams(list, o);
      res.log.forEach(function (m) { if (m !== '학생이 없습니다.') log.push(label + ': ' + m); });
      return res;
    }
    var rm = sub(boys, Km, 0, '남자 팀'), rf = sub(girls, Kf, Km, '여자 팀');
    var teams = rm.teams.concat(rf.teams);
    var split = { 남: Km, 여: Kf };
    var ev = evaluateGroups(inputStudents || [], teams, split);
    return {
      teams: teams, stats: null, groups: ev.groups, equity: ev.equity, seed: opts.seed, log: log,
      meta: { separate: split, genderBalance: false, restarts: opts.restarts, mix: (rm.meta && rm.meta.mix) || (rf.meta && rf.meta.mix) || null }
    };
  }
  /*
   * 성별 그룹별 통계. split 이 없으면 전체 한 그룹.
   * 반환 { groups:[{gender, label, idx:[팀번호], teams:[[ids]], stats, size}], equity }
   */
  function evaluateGroups(inputStudents, teams, split) {
    if (!split || (split['남'] | 0) + (split['여'] | 0) === 0) {
      var st0 = evaluateTeams(inputStudents, teams);
      return { groups: [{ gender: null, label: '', idx: teams.map(function (_, i) { return i; }), teams: teams, stats: st0, students: inputStudents || [], size: teams.reduce(function (a, t) { return a + t.length; }, 0) }], equity: st0.equity, Dp: st0.Dp, Dc: st0.Dc };
    }
    var Km = split['남'] | 0, Kf = split['여'] | 0;
    var groups = [], totalN = 0, eqSum = 0;
    [['남', 0, Km, '남자 팀'], ['여', Km, Km + Kf, '여자 팀']].forEach(function (g) {
      if (g[2] - g[1] <= 0) return;
      var idx = []; for (var t = g[1]; t < g[2]; t++) idx.push(t);
      var gTeams = idx.map(function (t) { return teams[t] || []; });
      var members = {}; gTeams.forEach(function (tm) { tm.forEach(function (id) { members[id] = true; }); });
      /* 기준 집단 = 그 성별 전체(+ 그 팀들에 들어 있는 학생) — 팀 간 비교는 같은 성별 안에서 */
      var studs = (inputStudents || []).filter(function (s) { return members[s.id] || gKey(s.gender) === g[0]; });
      var st = evaluateTeams(studs, gTeams);
      var n = gTeams.reduce(function (a, tm) { return a + tm.length; }, 0);
      groups.push({ gender: g[0], label: g[3], idx: idx, teams: gTeams, stats: st, students: studs, size: n });
      eqSum += st.equity * n; totalN += n;
    });
    return { groups: groups, equity: totalN ? Math.round(eqSum / totalN) : 0 };
  }

  /* 수동 조정 후 통계만 다시 계산. teams: [[ids]] */
  function evaluateTeams(inputStudents, teams) {
    var students = normalizeStudents(inputStudents || []);
    var K = teams.length;
    var st = new State(students, K);
    var idToIdx = {};
    students.forEach(function (s) { idToIdx[String(s.id)] = s.idx; });
    teams.forEach(function (ids, t) {
      ids.forEach(function (id) { var i = idToIdx[String(id)]; if (i !== undefined && st.team[i] < 0) st.add(i, t); });
    });
    var studentSd = studentSds(students);
    return computeStats(st, students, studentSd);
  }

  var api = {
    buildTeams: buildTeams, buildTeamsSeparate: buildTeamsSeparate, evaluateTeams: evaluateTeams, evaluateGroups: evaluateGroups, teamLabel: teamLabel,
    sharedPairs: sharedPairs,
    DEFAULTS: DEFAULTS, mulberry32: mulberry32,
    _internal: { teamSizes: teamSizes, genderQuotas: genderQuotas }
  };
  root.AgoraAlgorithm = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
