/* ============================================================
 * draft_logic.js — 드래프트 편성 규칙 (순수 함수, 시드 재현)
 *  mode 'auto'   : 교사 자동 편성 결과를 라운드별로 공개
 *  mode 'pick'   : 팀별 드래프트 — 체력 순으로 팀 수만큼 묶은 풀에서 뱀 순서로 지명
 *  mode 'credit' : 크레딧 드래프트 — 선수당 1~10 크레딧, 팀 예산 합 = 전체 크레딧 합
 * ============================================================ */
(function (root) {
  'use strict';

  var Q = root.AgoraQuestions || (typeof require === 'function' ? require('./questions.js') : null);
  var A = root.AgoraAlgorithm || (typeof require === 'function' ? require('./algorithm.js') : null);
  var VK = Q.VIRTUE_KEYS;
  var GENDERS = ['남', '여', '미상'];
  var api; /* 아래에서 정의 (ENDGAME 설정 참조용) */
  var VIRTUE_TYPE = { 성실: '성실형', 협동: '협동형', 정의: '정의형', 배려: '배려형' };
  var VIRTUE_ICON = { 성실: '🔥', 협동: '🤝', 정의: '⚖️', 배려: '💙' };

  function gKey(g) { return g === '남' || g === '여' ? g : '미상'; }
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function sd(a) { if (a.length < 2) return 0; var m = mean(a), ss = 0; a.forEach(function (x) { ss += (x - m) * (x - m); }); return Math.sqrt(ss / (a.length - 1)); }
  function shuffle(arr, rng) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
  function virtueMean(p) { return mean(VK.map(function (k) { return p.virtues[k]; })); }
  function percentile(values) {
    return function (v) {
      var less = 0, eq = 0;
      for (var i = 0; i < values.length; i++) { if (values[i] < v) less++; else if (values[i] === v) eq++; }
      return values.length ? (less + 0.5 * eq) / values.length : 0.5;
    };
  }

  /* ---------- 선수 프로필 (카드 표시용) ---------- */
  function profiles(prepared) {
    var classMean = {};
    VK.forEach(function (k) { classMean[k] = mean(prepared.map(function (p) { return p.virtues[k]; })); });
    var out = {};
    prepared.forEach(function (p) {
      var best = VK[0], bestDiff = -Infinity;
      VK.forEach(function (k) { var d = p.virtues[k] - classMean[k]; if (d > bestDiff) { bestDiff = d; best = k; } });
      out[p.id] = { type: VIRTUE_TYPE[best], typeKey: best, icon: VIRTUE_ICON[best], virtueMean: virtueMean(p), grade: p.papsGrade, stars: 6 - (p.papsGrade || 3) };
    });
    return out;
  }

  /* ---------- 크레딧 ---------- */
  /* opts.fitnessWeight: 체력 비중 0~1 (기본 0.6). 반환 {id: 1~10} */
  function computeCosts(prepared, opts) {
    opts = opts || {};
    var w = typeof opts.fitnessWeight === 'number' ? Math.max(0, Math.min(1, opts.fitnessWeight)) : 0.6;
    var pP = percentile(prepared.map(function (p) { return p.papsPoints; }));
    var pC = percentile(prepared.map(virtueMean));
    var costs = {};
    prepared.forEach(function (p) {
      var x = w * pP(p.papsPoints) + (1 - w) * pC(virtueMean(p));
      costs[p.id] = Math.max(1, Math.min(10, Math.round(1 + 9 * x)));
    });
    return costs;
  }

  function teamSlots(N, K) {
    var base = Math.floor(N / K), extra = N % K, slots = [];
    for (var t = 0; t < K; t++) slots.push(base + (t < extra ? 1 : 0));
    return slots;
  }

  /* 예산: 합계 = 전체 크레딧 합계, 인원(슬롯)에 비례 */
  function makeBudgets(costs, ids, slots) {
    var total = 0; ids.forEach(function (id) { total += costs[id] || 0; });
    var N = ids.length, K = slots.length, budgets = [], acc = 0;
    for (var t = 0; t < K; t++) { budgets.push(Math.floor(total * slots[t] / N)); acc += budgets[t]; }
    var rem = total - acc, t2 = 0;
    while (rem > 0) { budgets[t2 % K]++; rem--; t2++; }
    return budgets;
  }

  /* ---------- 지명 순서 ---------- */
  function serpentine(order, round) { return round % 2 === 0 ? order.slice() : order.slice().reverse(); }

  /*
   * 'pick' 모드 풀: 성별 그룹별로 PAPS 내림차순 → 2K명씩 '체력 구간' → 구간 안에서 인성 평균 순으로
   * K명씩 묶음(풀). 한 풀 안은 체력·인성 수준이 비슷하고 강점 덕목만 다르게 됨. 그룹은 번갈아 배치.
   */
  function buildPools(prepared, K, genderBalance, rng) {
    var groups = {};
    prepared.forEach(function (p) { var g = genderBalance ? gKey(p.gender) : 'all'; (groups[g] = groups[g] || []).push(p); });
    var chunksByGroup = Object.keys(groups).map(function (g) {
      var list = groups[g].slice();
      var jitter = {}; list.forEach(function (p) { jitter[p.id] = rng(); });
      list.sort(function (a, b) { return (b.papsPoints - a.papsPoints) || (jitter[a.id] - jitter[b.id]); });
      var chunks = [];
      for (var i = 0; i < list.length; i += 2 * K) {
        var band = list.slice(i, i + 2 * K);
        band.sort(function (a, b) { return (virtueMean(b) - virtueMean(a)) || (jitter[a.id] - jitter[b.id]); });
        for (var j = 0; j < band.length; j += K) chunks.push(band.slice(j, j + K).map(function (p) { return p.id; }));
      }
      return chunks;
    });
    chunksByGroup.sort(function (a, b) { return b.length - a.length; });
    var pools = [], maxLen = 0;
    chunksByGroup.forEach(function (c) { if (c.length > maxLen) maxLen = c.length; });
    for (var i = 0; i < maxLen; i++) chunksByGroup.forEach(function (c) { if (c[i]) pools.push(c[i]); });
    return pools;
  }

  /* ---------- 초기화 ---------- */
  /*
   * prepared: 점수 계산된 학생 배열, options: {mode, teamCount, genderBalance, seed, fitnessWeight, teamNames, autoTeams}
   */
  function initDraft(prepared, options) {
    options = options || {};
    var K = Math.max(1, options.teamCount | 0), N = prepared.length;
    var rng = A.mulberry32(((options.seed | 0) || 1) * 48271 + 7);
    var order = shuffle(Array.from({ length: K }, function (_, i) { return i; }), rng);
    var slots = teamSlots(N, K);
    var counts = { 남: 0, 여: 0, 미상: 0 };
    prepared.forEach(function (p) { counts[gKey(p.gender)]++; });
    /* 성별 균형: 팀별 성별 정원(합계 = 성별 인원, 팀 간 차 ≤1) — 알고리즘 모듈과 같은 규칙 */
    var gq = null;
    if (options.genderBalance && (counts['남'] + counts['여']) > 0) gq = A._internal.genderQuotas(slots, counts, A.mulberry32(((options.seed | 0) || 1) * 31 + 3));
    var state = {
      mode: options.mode || 'pick', K: K, N: N, slots: slots, order: order, genderBalance: !!options.genderBalance, gq: gq,
      teamNames: (options.teamNames || []).slice(0, K), picks: [], teams: Array.from({ length: K }, function () { return []; }),
      sequence: [], cursor: 0, status: 'running', seed: options.seed || 1, createdAt: new Date().toISOString(),
      pinned: {}, prePlaced: []
    };
    while (state.teamNames.length < K) state.teamNames.push((state.teamNames.length + 1) + '팀');
    /* 팀 고정: 미리 배치 (교사 편성은 알고리즘이 처리하므로 제외) */
    var idSet = {}; prepared.forEach(function (p) { idSet[p.id] = true; });
    if (state.mode !== 'auto') Object.keys(options.pinned || {}).forEach(function (id) {
      var t = parseInt(options.pinned[id], 10);
      if (!idSet[id] || isNaN(t) || t < 0 || t >= K) return;
      state.pinned[id] = t; state.prePlaced.push(id); state.teams[t].push(id);
    });
    var pinnedCount = Array.from({ length: K }, function (_, t) { return state.teams[t].length; });
    var unpinned = prepared.filter(function (p) { return state.pinned[p.id] === undefined; });
    /* 익명 드래프트: 출석번호와 무관한 무작위 코드 */
    state.anonymous = !!options.anonymous;
    if (state.anonymous) {
      var nums = shuffle(Array.from({ length: N }, function (_, i) { return i + 1; }), rng);
      state.codes = {};
      prepared.forEach(function (p, i) { state.codes[p.id] = '선수 ' + (nums[i] < 10 ? '0' : '') + nums[i]; });
    }

    if (state.mode === 'pick') {
      state.pools = buildPools(unpinned, K, state.genderBalance, rng);
      state.sequence = [];
      /* 팀별 지명 횟수 = 정원 − 미리 배치된 인원. 풀마다 (팀 인원이 적은 팀 → 뱀 순서) 로 지명 */
      var need = slots.map(function (s, t) { return Math.max(0, s - pinnedCount[t]); });
      var totalNeed = need.reduce(function (a, b) { return a + b; }, 0);
      while (totalNeed < unpinned.length) { var tt = need.indexOf(Math.min.apply(null, need)); need[tt]++; totalNeed++; } // 고정이 많아 정원이 모자랄 때
      var cnt = pinnedCount.slice(), available = 0;
      state.pools.forEach(function (pool, p) {
        available += pool.length;
        var ord = serpentine(order, p).filter(function (t) { return need[t] > 0; });
        var rank = {}; ord.forEach(function (t, i) { rank[t] = i; });
        ord = ord.slice().sort(function (a, b) { return (cnt[a] - cnt[b]) || (rank[a] - rank[b]); });
        ord.slice(0, Math.min(available, ord.length)).forEach(function (t) { state.sequence.push({ team: t, round: p, pool: p }); cnt[t]++; need[t]--; available--; });
      });
      /* 남은 학생(풀보다 지명 가능한 팀이 적었던 경우)은 마지막 풀에서 이어서 지명 */
      var lastPool = state.pools.length - 1;
      while (available > 0) {
        var t2 = -1; for (var u = 0; u < K; u++) if (need[u] > 0 && (t2 < 0 || cnt[u] < cnt[t2])) t2 = u;
        if (t2 < 0) break;
        state.sequence.push({ team: t2, round: lastPool, pool: lastPool }); cnt[t2]++; need[t2]--; available--;
      }
      /* 풀 기반이므로 팀 인원은 시퀀스 + 고정으로 결정 */
      state.slots = pinnedCount.slice();
      state.sequence.forEach(function (sq) { state.slots[sq.team]++; });
    } else if (state.mode === 'credit') {
      state.costs = computeCosts(prepared, { fitnessWeight: options.fitnessWeight });
      state.budgets = makeBudgets(state.costs, prepared.map(function (p) { return p.id; }), slots);
      state.spent = Array.from({ length: K }, function () { return 0; });
      state.prePlaced.forEach(function (id) { state.spent[state.pinned[id]] += state.costs[id]; });
      var needC = slots.map(function (s, t) { return Math.max(0, s - pinnedCount[t]); });
      var maxNeed = Math.max.apply(null, needC.concat([0]));
      for (var r = 0; r < maxNeed; r++) serpentine(order, r).forEach(function (t) { if (needC[t] > r) state.sequence.push({ team: t, round: r }); });
    } else { /* auto: 공개 순서 */
      var teams = options.autoTeams || [];
      state.teams = Array.from({ length: K }, function () { return []; });
      /* 공개 순서는 팀 안에서 무작위(시드) — 체력 순으로 공개하면 서열이 드러남 */
      var sorted = teams.map(function (ids) { return shuffle(ids.slice(), rng); });
      var maxLen = Math.max.apply(null, sorted.map(function (t) { return t.length; }).concat([0]));
      for (var rr = 0; rr < maxLen; rr++) serpentine(order, rr).forEach(function (t) { if (sorted[t] && sorted[t][rr]) state.sequence.push({ team: t, round: rr, id: sorted[t][rr] }); });
      state.slots = sorted.map(function (t) { return t.length; });
    }
    return state;
  }

  function currentPick(state) { return state.cursor < state.sequence.length ? state.sequence[state.cursor] : null; }
  function isDone(state) { return state.cursor >= state.sequence.length; }
  function pickedSet(state) {
    var s = {};
    state.picks.forEach(function (p) { s[p.id] = true; });
    (state.prePlaced || []).forEach(function (id) { s[id] = true; });
    return s;
  }
  function remainingSlots(state, t) { return state.slots[t] - state.teams[t].length; }
  function genderCount(state, prepared, t, g) {
    var byId = {}; prepared.forEach(function (p) { byId[p.id] = p; });
    return state.teams[t].filter(function (id) { return byId[id] && gKey(byId[id].gender) === g; }).length;
  }

  /* 남은 슬롯을 가장 싼(또는 가장 비싼) 선수들로 채울 때 드는 비용 */
  function fillCost(state, unpickedIds, exceptId, n, expensive) {
    if (n <= 0) return 0;
    var cs = unpickedIds.filter(function (id) { return id !== exceptId; }).map(function (id) { return state.costs[id]; }).sort(function (a, b) { return expensive ? b - a : a - b; });
    var s = 0; for (var i = 0; i < Math.min(n, cs.length); i++) s += cs[i];
    return s;
  }
  function minFillCost(state, ids, exceptId, n) { return fillCost(state, ids, exceptId, n, false); }

  /* 정확히 n명을 골라 만들 수 있는 비용 합 집합 (불리언 배열) */
  function sumsWithCount(costs, n, maxSum) {
    var dp = [];
    for (var c = 0; c <= n; c++) dp.push(new Uint8Array(maxSum + 1));
    dp[0][0] = 1;
    costs.forEach(function (cost) {
      for (var c = n; c >= 1; c--) for (var s = maxSum; s >= cost; s--) if (dp[c - 1][s - cost]) dp[c][s] = 1;
    });
    return dp[n];
  }
  /*
   * 후보를 고른 뒤, 남은 자리(성별 정원 포함)를 남은 선수들로 채우면서 예산을 '정확히' 다 쓸 수 있는가
   */
  function canFinishExactly(state, byId, team, candId, poolIds) {
    var left = state.budgets[team] - state.spent[team] - state.costs[candId];
    if (left < 0) return false;
    var others = poolIds.filter(function (id) { return id !== candId; });
    var rsAfter = remainingSlots(state, team) - 1;
    if (rsAfter === 0) return left === 0;
    var groups = {};
    if (state.gq) {
      var cg = gKey(byId[candId].gender);
      GENDERS.forEach(function (g) {
        var have = state.teams[team].filter(function (id) { return byId[id] && gKey(byId[id].gender) === g; }).length + (g === cg ? 1 : 0);
        var need = state.gq[g][team] - have;
        if (need > 0) groups[g] = need;
      });
    } else groups.all = rsAfter;
    var reach = new Uint8Array(left + 1); reach[0] = 1;
    var keys = Object.keys(groups);
    for (var i = 0; i < keys.length; i++) {
      var g = keys[i], need = groups[g];
      var costs = others.filter(function (id) { return g === 'all' || gKey(byId[id].gender) === g; }).map(function (id) { return state.costs[id]; });
      if (costs.length < need) return false;
      var sums = sumsWithCount(costs, need, left);
      var next = new Uint8Array(left + 1);
      for (var a = 0; a <= left; a++) if (reach[a]) for (var b = 0; a + b <= left; b++) if (sums[b]) next[a + b] = 1;
      reach = next;
    }
    return !!reach[left];
  }

  /*
   * 종반(남은 선수 ≤ limitN): 남은 선수 전원을 모든 팀의 남은 자리에 배정하면서
   * 모든 팀이 예산을 정확히 쓰고 성별 정원도 맞출 수 있는지 되추적으로 확인
   */
  function globalExactFeasible(state, byId, poolIds, nodeLimit) {
    var teams = [];
    for (var t = 0; t < state.K; t++) {
      var rs = remainingSlots(state, t);
      if (rs <= 0) continue;
      var need = null;
      if (state.gq) {
        need = {};
        GENDERS.forEach(function (g) {
          var have = state.teams[t].filter(function (id) { return byId[id] && gKey(byId[id].gender) === g; }).length;
          need[g] = state.gq[g][t] - have;
        });
      }
      teams.push({ t: t, left: state.budgets[t] - state.spent[t], rs: rs, need: need });
    }
    var ids = poolIds.slice().sort(function (a, b) { return state.costs[b] - state.costs[a]; });
    var totalLeft = teams.reduce(function (a, tm) { return a + tm.left; }, 0);
    var totalCost = ids.reduce(function (a, id) { return a + state.costs[id]; }, 0);
    if (totalLeft !== totalCost) return false;
    var nodes = 0, limit = nodeLimit || 30000;
    function rec(i) {
      if (++nodes > limit) throw new Error('limit');
      if (i === ids.length) return teams.every(function (tm) { return tm.rs === 0 && tm.left === 0; });
      var id = ids[i], cost = state.costs[id], g = gKey(byId[id].gender);
      /* 남은 선수들의 비용(오름차순)으로 하한·상한 가지치기 */
      var rest = ids.slice(i + 1).map(function (x) { return state.costs[x]; }).sort(function (a, b) { return a - b; });
      for (var k = 0; k < teams.length; k++) {
        var tm = teams[k];
        if (tm.rs <= 0 || tm.left < cost) continue;
        if (tm.need && tm.need[g] <= 0) continue;
        var after = tm.left - cost, n = tm.rs - 1;
        var minS = 0, maxS = 0;
        for (var a = 0; a < n && a < rest.length; a++) { minS += rest[a]; maxS += rest[rest.length - 1 - a]; }
        if (n > rest.length || after < minS || after > maxS) continue;
        tm.rs--; tm.left -= cost; if (tm.need) tm.need[g]--;
        var ok = rec(i + 1);
        tm.rs++; tm.left += cost; if (tm.need) tm.need[g]++;
        if (ok) return true;
      }
      return false;
    }
    try { return rec(0); } catch (e) { return true; } /* 탐색 한도 초과 → 막지 않음 */
  }

  /* 현재 지명 팀이 고를 수 있는 후보 */
  function candidates(state, prepared) {
    var cur = currentPick(state);
    if (!cur) return { ids: [], forced: false, reasons: {} };
    /* 교사 편성 공개: 정해진 순서의 선수를 그대로 공개 (정원·예산 검사 없음) */
    if (state.mode === 'auto') return { ids: cur.id ? [cur.id] : [], forced: false, reasons: {} };
    var picked = pickedSet(state);
    var byId = {}; prepared.forEach(function (p) { byId[p.id] = p; });
    var reasons = {};
    /* pick: 현재 풀까지의 미지명 학생 (앞 풀에서 남은 학생은 이어서 지명) */
    var base = state.mode === 'pick'
      ? [].concat.apply([], state.pools.slice(0, cur.pool + 1)).filter(function (id) { return !picked[id]; })
      : prepared.map(function (p) { return p.id; }).filter(function (id) { return !picked[id]; });
    /* 1) 성별 정원 */
    var genderOk = base.filter(function (id) {
      var p = byId[id]; if (!p) return false;
      if (state.gq && state.mode !== 'pick') {
        var g = gKey(p.gender);
        if (genderCount(state, prepared, cur.team, g) >= state.gq[g][cur.team]) { reasons[id] = '이 팀의 ' + (g === '미상' ? '성별 미상' : g + '학생') + ' 정원이 찼습니다'; return false; }
      }
      return true;
    });
    /* 2) 크레딧: 예산 안이어야 하고, 남은 자리를 채울 수 있어야 하며(하한), 다 쓸 수 있어야 함(상한) */
    if (state.mode !== 'credit') return { ids: genderOk.length ? genderOk : base, forced: !genderOk.length && base.length > 0, reasons: reasons };
    var left = state.budgets[cur.team] - state.spent[cur.team];
    var rs = remainingSlots(state, cur.team) - 1;
    var lowerOk = genderOk.filter(function (id) {
      var cost = state.costs[id];
      if (cost > left) { reasons[id] = '크레딧 부족'; return false; }
      if (left - cost < minFillCost(state, genderOk, id, rs)) { reasons[id] = '남은 인원을 채울 크레딧 부족'; return false; }
      return true;
    });
    var exactOk = lowerOk.filter(function (id) {
      if (!canFinishExactly(state, byId, cur.team, id, genderOk)) { reasons[id] = '이 선수를 고르면 예산을 정확히 다 쓸 수 없습니다'; return false; }
      return true;
    });
    /* 종반에는 전체 팀이 동시에 정확히 소진할 수 있는지까지 확인 */
    if (exactOk.length && base.length <= api.ENDGAME.n) {
      var globalOk = exactOk.filter(function (id) {
        var cost = state.costs[id];
        state.teams[cur.team].push(id); state.spent[cur.team] += cost;
        var ok = globalExactFeasible(state, byId, base.filter(function (x) { return x !== id; }));
        state.teams[cur.team].pop(); state.spent[cur.team] -= cost;
        if (!ok) reasons[id] = '이 선수를 고르면 다른 팀이 예산을 정확히 쓸 수 없습니다';
        return ok;
      });
      if (globalOk.length) return { ids: globalOk, forced: false, reasons: reasons };
    }
    if (exactOk.length) return { ids: exactOk, forced: false, loose: base.length <= api.ENDGAME.n, reasons: reasons };
    if (lowerOk.length) return { ids: lowerOk, forced: false, loose: true, reasons: reasons };
    if (genderOk.length) return { ids: genderOk, forced: true, reasons: reasons };
    return { ids: base, forced: true, reasons: reasons };
  }

  function pick(state, id, prepared) {
    var cur = currentPick(state);
    if (!cur) return { ok: false, error: '드래프트가 끝났습니다.' };
    if (state.mode === 'auto') id = cur.id;
    var c = candidates(state, prepared);
    if (c.ids.indexOf(id) < 0) return { ok: false, error: c.reasons[id] || '지금은 고를 수 없는 선수입니다.' };
    var cost = state.mode === 'credit' ? state.costs[id] : 0;
    state.picks.push({ team: cur.team, id: id, round: cur.round, cost: cost, forced: c.forced, at: Date.now() });
    state.teams[cur.team].push(id);
    if (state.mode === 'credit') state.spent[cur.team] += cost;
    state.cursor++;
    if (isDone(state)) state.status = 'done';
    return { ok: true, team: cur.team, cost: cost, forced: c.forced };
  }

  function undo(state) {
    var last = state.picks.pop();
    if (!last) return false;
    var arr = state.teams[last.team]; arr.splice(arr.lastIndexOf(last.id), 1);
    if (state.mode === 'credit') state.spent[last.team] -= last.cost;
    state.cursor--; state.status = 'running';
    return true;
  }

  /* 자동 지명: 팀 평균이 학급 평균에 가까워지는 후보 (크레딧은 슬롯당 평균 예산에 가까운 비용 선호) */
  function autoPick(state, prepared) {
    var cur = currentPick(state);
    if (!cur) return null;
    if (state.mode === 'auto') return cur.id;
    var c = candidates(state, prepared);
    if (!c.ids.length) return null;
    var byId = {}; prepared.forEach(function (p) { byId[p.id] = p; });
    var cm = { paps: mean(prepared.map(function (p) { return p.papsPoints; })) };
    VK.forEach(function (k) { cm[k] = mean(prepared.map(function (p) { return p.virtues[k]; })); });
    var sdP = sd(prepared.map(function (p) { return p.papsPoints; })) || 1;
    var sdV = {}; VK.forEach(function (k) { sdV[k] = sd(prepared.map(function (p) { return p.virtues[k]; })) || 1; });
    var members = state.teams[cur.team].map(function (id) { return byId[id]; }).filter(Boolean);
    var best = null, bestScore = Infinity;
    c.ids.forEach(function (id) {
      var p = byId[id], all = members.concat([p]);
      var score = Math.abs(mean(all.map(function (x) { return x.papsPoints; })) - cm.paps) / sdP;
      VK.forEach(function (k) { score += Math.abs(mean(all.map(function (x) { return x.virtues[k]; })) - cm[k]) / sdV[k]; });
      if (state.mode === 'credit') {
        var left = state.budgets[cur.team] - state.spent[cur.team], rs = remainingSlots(state, cur.team);
        /* 자리가 줄수록 '남은 예산 ÷ 남은 자리'에 가까운 비용을 강하게 선호 (끝에서 정확히 소진) */
        score += Math.abs(state.costs[id] - left / Math.max(1, rs)) * (0.4 + 1.5 / Math.max(1, rs));
      }
      if (score < bestScore) { bestScore = score; best = id; }
    });
    return best;
  }

  /* 남은(미지명) 선수를 슬롯이 남은 팀에 자동 배정 (크레딧 모드 강제 종료용) */
  function fillRemaining(state, prepared) {
    var picked = pickedSet(state);
    var rest = prepared.filter(function (p) { return !picked[p.id]; });
    rest.sort(function (a, b) { return b.papsPoints - a.papsPoints; });
    rest.forEach(function (p) {
      var bestT = -1, bestLeft = -Infinity;
      for (var t = 0; t < state.K; t++) {
        if (remainingSlots(state, t) <= 0) continue;
        var left = state.mode === 'credit' ? state.budgets[t] - state.spent[t] : remainingSlots(state, t);
        if (left > bestLeft) { bestLeft = left; bestT = t; }
      }
      if (bestT < 0) { bestT = 0; for (var u = 1; u < state.K; u++) if (state.teams[u].length < state.teams[bestT].length) bestT = u; }
      var cost = state.mode === 'credit' ? state.costs[p.id] : 0;
      state.picks.push({ team: bestT, id: p.id, round: -1, cost: cost, forced: true, auto: true, at: Date.now() });
      state.teams[bestT].push(p.id);
      if (state.mode === 'credit') state.spent[bestT] += cost;
    });
    state.cursor = state.sequence.length; state.status = 'done';
  }

  function summary(state) {
    var out = { picks: state.picks.length, total: state.sequence.length };
    if (state.mode === 'credit') {
      out.leftover = state.budgets.map(function (b, t) { return b - state.spent[t]; });
      out.totalBudget = state.budgets.reduce(function (a, b) { return a + b; }, 0);
      out.unused = out.leftover.reduce(function (a, l) { return a + Math.max(0, l); }, 0);
      out.over = out.leftover.reduce(function (a, l) { return a + Math.max(0, -l); }, 0);
    }
    return out;
  }

  api = {
    ENDGAME: { n: 18 }, /* 남은 선수가 이 수 이하이면 전체 팀 동시 소진 가능성 검사 */
    profiles: profiles, computeCosts: computeCosts, makeBudgets: makeBudgets, teamSlots: teamSlots, buildPools: buildPools,
    initDraft: initDraft, currentPick: currentPick, isDone: isDone, candidates: candidates, pick: pick, undo: undo,
    autoPick: autoPick, fillRemaining: fillRemaining, summary: summary, remainingSlots: remainingSlots, serpentine: serpentine,
    VIRTUE_TYPE: VIRTUE_TYPE, VIRTUE_ICON: VIRTUE_ICON
  };
  root.AgoraDraft = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
