/* ============================================================
 * algorithm.js — 팀 편성 (순수 함수, 시드 재현 가능)
 *  1차: PAPS 서펜타인 드래프트 (성별 그룹별) → 팀 평균 PAPS 균등
 *  2차: 교환/이동 지역 탐색 → PAPS 범위를 허용편차(τ) 안에 유지하며
 *       4덕목(성실·협동·정의·배려) 팀 평균 편차 최소화
 *  J = 1000·max(0, Dp−τ) + Dc + 0.05·Dp   (PAPS·인성 합산 없음)
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
      return {
        id: s.id, idx: idx, name: s.name,
        g: gKey(s.gender),
        p: (typeof s.papsZ === 'number' && !isNaN(s.papsZ)) ? s.papsZ : 0,
        v: v
      };
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
  function objective(sp, tau) {
    return 1000 * Math.max(0, sp.Dp - tau) + sp.Dc + 0.05 * sp.Dp;
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

  /* ---------- 1차: 서펜타인 드래프트 ---------- */
  function draft(students, K, C, quotas, sizes, rng, genderBalance) {
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
      var jitter = {};
      list.forEach(function (i) { jitter[i] = rng(); });
      list.sort(function (a, b) { return (students[b].p - students[a].p) || (jitter[a] - jitter[b]); });
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
        if (!placed) { // 쿼터가 꼬인 경우: 가장 여유 있는 팀
          var bt = 0;
          for (var u = 1; u < K; u++) if (totalRoom[u] > totalRoom[bt]) bt = u;
          totalRoom[bt]--; st.add(i, bt);
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
    var cur = spreads(st, studentSd), J = objective(cur, tau);
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
        var sp = spreads(st, studentSd), Jn = objective(sp, tau);
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
          var sp2 = spreads(st, studentSd), J2 = objective(sp2, tau);
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
    var equity = Math.round(100 * (1 - 0.5 * Math.min(1, sp.Dp / 1.0) - 0.5 * Math.min(1, sp.Dc / 2.0)));
    return { teams: teams, metrics: metrics, Dp: sp.Dp, Dc: sp.Dc, equity: Math.max(0, Math.min(100, equity)) };
  }

  function studentSds(students) {
    var o = { PAPS: sdSample(students.map(function (s) { return s.p; })) };
    VK.forEach(function (k) { o[k] = sdSample(students.map(function (s) { return s.v[k]; })); });
    return o;
  }

  /* ---------- 공개 API ---------- */
  var DEFAULTS = { teamCount: 6, genderBalance: true, papsTolerance: 0.3, seed: 1, restarts: 5, maxEvals: 20000, together: [], apart: [], pinned: {} };

  /*
   * students: [{id, name, gender, papsZ, virtues:{성실,협동,정의,배려}}]
   * 반환: { teams:[[ids]], stats, equity, seed, log, meta }
   */
  function buildTeams(inputStudents, options) {
    options = Object.assign({}, DEFAULTS, options || {});
    var log = [];
    var K = Math.max(1, Math.floor(options.teamCount || 1));
    var students = normalizeStudents(inputStudents || []);
    var N = students.length;
    if (N === 0) return { teams: Array.from({ length: K }, function () { return []; }), stats: null, equity: 0, seed: options.seed, log: ['학생이 없습니다.'] };
    if (N < 2 * K) log.push('학생 수(' + N + ')가 팀 수의 2배보다 적어 팀당 인원이 매우 적습니다.');
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
    log = log.concat(best.rlog);
    var stats = computeStats(best.st, students, studentSd);
    var teams = best.st.members.map(function (ms) {
      return ms.slice().sort(function (a, b) { return students[b].p - students[a].p; }).map(function (i) { return students[i].id; });
    });
    return {
      teams: teams, stats: stats, equity: stats.equity, seed: options.seed, log: log,
      meta: { evals: best.ls.evals, rounds: best.ls.rounds, J: best.ls.J, restarts: restarts, genderBalance: genderBalance }
    };
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
    buildTeams: buildTeams, evaluateTeams: evaluateTeams, DEFAULTS: DEFAULTS, mulberry32: mulberry32,
    _internal: { teamSizes: teamSizes, genderQuotas: genderQuotas }
  };
  root.AgoraAlgorithm = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
