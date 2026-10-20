/* ============================================================
 * draft_ui.js — 팀 드래프트 화면 (발표·공유용)
 * ============================================================ */
(function (root) {
  'use strict';

  var Q = root.AgoraQuestions, S = root.AgoraScoring, A = root.AgoraAlgorithm, St = root.AgoraState, D = root.AgoraDraft;
  var VK = Q.VIRTUE_KEYS;
  var COLORS = ['#4f8cff', '#fb7185', '#2dd4bf', '#fbbf24', '#a78bfa', '#38bdf8', '#fb923c', '#4ade80', '#f472b6', '#94a3b8', '#2dd4bf', '#c084fc'];
  var MODE_LABEL = { auto: '교사 편성', pick: '팀별 드래프트', credit: '크레딧 드래프트' };

  /* ---------- DOM 도우미 ---------- */
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    if (c instanceof Node) el.appendChild(c); else el.appendChild(document.createTextNode(String(c)));
  }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
      else if (k === 'style') el.style.cssText = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }
  var toastTimer = null;
  function toast(msg, isError) {
    var el = $('#d-toast');
    el.textContent = msg; el.hidden = false; el.classList.toggle('error', !!isError);
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 4000 : 2500);
  }
  function color(t) { return COLORS[t % COLORS.length]; }
  function fmt(x, d) { return (typeof x === 'number' && isFinite(x)) ? x.toFixed(d === undefined ? 1 : d) : '–'; }

  /* ---------- 상태 ---------- */
  var session, prepared = [], byId = {}, prof = {}, draft = null;
  var ui = { mode: 'pick', seed: 1, detail: false, autoplay: null, timer: null, timerLeft: 0, lastReveal: null, confettiDone: false, revealNames: false, revealAnim: false };

  /* 익명 드래프트 표시 도우미 */
  function showNames() { return !draft || !draft.anonymous || ui.revealNames; }
  function labelOf(p) { return showNames() ? (p.name || '(이름 없음)') : (draft.codes && draft.codes[p.id]) || '선수'; }
  function avatarText(p) {
    if (showNames()) return p.no !== null && p.no !== undefined ? p.no : '?';
    var c = draft.codes && draft.codes[p.id]; return c ? c.replace(/\D/g, '') : '?';
  }

  function persist() { St.update(function (s) { s.draft = draft; }, { noUndo: true }); St.persistNow(); }

  function load() {
    St.load();
    session = St.get();
    prepared = S.prepareStudents(session.students, session.options);
    byId = {}; prepared.forEach(function (p) { byId[p.id] = p; });
    prof = D.profiles(prepared);
    $('#d-class').textContent = session.classLabel ? session.classLabel + ' 학급 · ' + prepared.length + '명' : prepared.length + '명';
    var d = session.draft;
    var ids = prepared.map(function (p) { return p.id; }).sort().join('|');
    if (d && d.sequence && d.studentKey === ids && (d.status === 'running' || d.status === 'done')) { draft = d; showStage(); }
    else { draft = null; showSetup(); }
  }

  /* ============================================================ 준비 화면 */
  function showSetup() {
    $('#d-setup').hidden = false; $('#d-stage').hidden = true; $('#d-boards').hidden = true; $('#d-controls').hidden = true;
    $('#d-mode').textContent = '준비';
    var o = session.options;
    ui.mode = o.draftMode || 'pick'; ui.seed = (o.seed | 0) || 1;
    $$('.mode-card').forEach(function (b) { b.classList.toggle('selected', b.dataset.mode === ui.mode); });
    $('#d-teamCount').value = o.teamCount || 6;
    $('#d-gender').checked = !!o.genderBalance;
    $('#d-weight').value = typeof o.creditFitnessWeight === 'number' ? o.creditFitnessWeight : 0.6;
    $('#d-weight-val').textContent = Math.round($('#d-weight').value * 100) + '%';
    $('#d-timer').checked = !!(o.draftTimerSec > 0);
    if (o.draftTimerSec > 0) $('#d-timer-sec').value = o.draftTimerSec;
    $('#d-anon').checked = o.draftAnonymous !== false;
    $('#d-setup-info').textContent = prepared.length ? ('학생 ' + prepared.length + '명 (남 ' + prepared.filter(function (p) { return p.gender === '남'; }).length + ' · 여 ' + prepared.filter(function (p) { return p.gender === '여'; }).length + '). 방식을 고르고 시작하세요.') : '학생 자료가 없습니다. 메인 화면 1단계에서 자료를 불러온 뒤 다시 여세요.';
    $('#d-start').disabled = !prepared.length;
    renderNames(); renderOrder(); updateModeUI();
  }
  function updateModeUI() {
    $('#d-weight-wrap').style.display = ui.mode === 'credit' ? '' : 'none';
    $('#d-anon-wrap').style.display = ui.mode === 'auto' ? 'none' : '';
    var warn = '';
    if (ui.mode === 'auto') warn = '시작하면 메인 3단계 설정(허용편차·제약 조건 포함)과 추첨 시드로 팀을 새로 편성해 한 명씩 공개합니다. 다른 조합을 원하면 🎲 순서 추첨을 다시 누르세요.';
    if (ui.mode !== 'auto' && prepared.some(function (p) { return !p.gender; }) && $('#d-gender').checked) warn = '성별이 없는 학생은 별도 풀(미상)로 지명됩니다. 메인 명단에서 성별을 채우면 더 정확합니다.';
    $('#d-setup-warn').textContent = warn;
  }
  function renderNames() {
    var K = Math.max(1, parseInt($('#d-teamCount').value, 10) || 6);
    var names = (session.teamNames || []).slice();
    var box = clear($('#d-names'));
    for (var t = 0; t < K; t++) {
      box.appendChild(h('label', null, h('i', { style: 'background:' + color(t) }), h('input', { type: 'text', value: names[t] || ((t + 1) + '팀'), placeholder: (t + 1) + '팀', 'data-team': t, maxlength: 12 })));
    }
  }
  function currentNames() {
    return $$('#d-names input').map(function (inp, t) { return inp.value.trim() || ((t + 1) + '팀'); });
  }
  function renderOrder() {
    var K = Math.max(1, parseInt($('#d-teamCount').value, 10) || 6);
    var names = currentNames();
    var st = D.initDraft(prepared.slice(0, 1), { mode: 'credit', teamCount: K, seed: ui.seed, teamNames: names });
    var box = clear($('#d-order'));
    box.appendChild(h('span', { class: 'hint', text: '1라운드 순서: ' }));
    st.order.forEach(function (t, i) { box.appendChild(h('span', { class: 'chip', style: 'background:' + color(t) + ';animation-delay:' + (i * 90) + 'ms', text: (i + 1) + '. ' + names[t] })); });
  }
  function bindSetup() {
    $$('.mode-card').forEach(function (b) { b.addEventListener('click', function () { ui.mode = b.dataset.mode; $$('.mode-card').forEach(function (x) { x.classList.toggle('selected', x === b); }); updateModeUI(); }); });
    $('#d-teamCount').addEventListener('change', function () { renderNames(); renderOrder(); });
    $('#d-gender').addEventListener('change', updateModeUI);
    $('#d-weight').addEventListener('input', function (e) { $('#d-weight-val').textContent = Math.round(e.target.value * 100) + '%'; });
    $('#d-lottery').addEventListener('click', function () { ui.seed = 1 + Math.floor(Math.random() * 1e6); renderOrder(); });
    $('#d-names').addEventListener('input', renderOrder);
    $('#d-start').addEventListener('click', start);
  }

  function start() {
    var K = Math.max(1, parseInt($('#d-teamCount').value, 10) || 6);
    if (prepared.length < K) { toast('학생 수보다 팀 수가 많습니다.', true); return; }
    var names = currentNames();
    var genderBalance = $('#d-gender').checked;
    var weight = parseFloat($('#d-weight').value);
    var timerSec = $('#d-timer').checked ? Math.max(5, parseInt($('#d-timer-sec').value, 10) || 30) : 0;
    var autoTeams = null;
    if (ui.mode === 'auto') {
      /* 시작할 때마다 현재 설정(팀 수·성별 균형·허용편차·제약)과 추첨 시드로 새로 편성 */
      var res = A.buildTeams(prepared, Object.assign({}, session.options, { teamCount: K, genderBalance: genderBalance, seed: ui.seed }));
      autoTeams = res.teams;
      if (res.log && res.log.length) toast(res.log[0]);
    }
    var anonymous = ui.mode !== 'auto' && $('#d-anon').checked;
    draft = D.initDraft(prepared, { mode: ui.mode, teamCount: K, genderBalance: genderBalance, seed: ui.seed, fitnessWeight: weight, teamNames: names, autoTeams: autoTeams, anonymous: anonymous });
    draft.studentKey = prepared.map(function (p) { return p.id; }).sort().join('|');
    draft.timerSec = timerSec;
    St.update(function (s) {
      s.draft = draft; s.teamNames = names;
      s.options.draftMode = ui.mode; s.options.teamCount = K; s.options.genderBalance = genderBalance; s.options.creditFitnessWeight = weight; s.options.draftTimerSec = timerSec;
      s.options.draftAnonymous = $('#d-anon').checked;
    }, { noUndo: true });
    St.persistNow();
    ui.confettiDone = false; ui.revealNames = false; ui.revealAnim = false;
    showStage();
  }

  /* ============================================================ 진행 화면 */
  function showStage() {
    $('#d-setup').hidden = true; $('#d-stage').hidden = false; $('#d-boards').hidden = false; $('#d-controls').hidden = false;
    $('#d-mode').textContent = (MODE_LABEL[draft.mode] || draft.mode) + (draft.anonymous ? ' · 익명' : '');
    $('#d-auto').textContent = draft.mode === 'auto' ? '다음 공개' : '자동 지명';
    $('#d-detail').checked = ui.detail;
    $('#d-reveal-wrap').hidden = !draft.anonymous;
    $('#d-reveal').checked = ui.revealNames;
    render();
  }

  function render() {
    renderHead(); renderPool(); renderBoards(); updateTimer();
    $('#d-undo').disabled = !draft.picks.length;
    $('#d-auto').disabled = D.isDone(draft);
  }

  function renderHead() {
    var cur = D.currentPick(draft);
    var total = draft.sequence.length, done = draft.cursor;
    var rounds = draft.sequence.length ? draft.sequence[draft.sequence.length - 1].round + 1 : 0;
    $('#d-round').textContent = cur ? ('라운드 ' + (cur.round + 1) + ' / ' + rounds + ' · 지명 ' + (done + 1) + ' / ' + total) : ('완료 · ' + total + '명 지명');
    var now = clear($('#d-now'));
    if (cur) {
      now.appendChild(h('span', { class: 'team-dot', style: 'background:' + color(cur.team) }));
      now.appendChild(h('span', { text: draft.teamNames[cur.team] + (draft.mode === 'auto' ? ' 선수 공개' : ' 지명 차례') }));
      if (draft.mode === 'credit') now.appendChild(h('span', { class: 'sub', text: '남은 크레딧 ' + (draft.budgets[cur.team] - draft.spent[cur.team]) + ' / 남은 자리 ' + D.remainingSlots(draft, cur.team) }));
      else if (draft.mode === 'pick') now.appendChild(h('span', { class: 'sub', text: '풀 ' + (cur.pool + 1) + '/' + draft.pools.length + ' · 체력·인성 수준이 비슷한 ' + draft.pools[cur.pool].length + '명 중 원하는 덕목 성향을 고르세요' }));
    } else now.appendChild(h('span', { text: '🎉 드래프트 완료!' }));
    $('#d-progress-bar').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  }

  /* ---------- 선수 카드 ---------- */
  function initials(p) { var nm = p.name || ''; return nm.length > 2 ? nm.slice(1) : nm || String(p.no || '?'); }
  function stars(n) {
    var el = h('span', { class: 'stars', title: '체력 ' + (6 - n) + '등급' });
    for (var i = 1; i <= 5; i++) el.appendChild(h('span', { class: i <= n ? '' : 'off', text: '★' }));
    return el;
  }
  function card(id, opts) {
    opts = opts || {};
    var p = byId[id], pr = prof[id];
    var el = h('div', { class: 'card' + (opts.disabled ? ' disabled' : '') + (opts.forced ? ' forced' : '') + (ui.revealAnim ? ' reveal' : ''), dataset: { id: id }, style: 'animation-delay:' + ((opts.index || 0) * 45) + 'ms' });
    el.appendChild(h('div', { class: 'top' },
      h('div', { class: 'avatar', style: 'background:' + (p.gender === '여' ? '#fda4af' : p.gender === '남' ? '#93c5fd' : '#cbd5e1'), text: avatarText(p) }),
      h('div', { class: 'who' }, h('div', { class: 'nm', text: labelOf(p) }),
        h('div', { class: 'meta' }, p.gender ? h('span', { class: 'g ' + (p.gender === '남' ? 'm' : 'f'), text: p.gender }) : null, stars(pr.stars)))));
    el.appendChild(h('div', { class: 'type', text: pr.icon + ' ' + pr.type }));
    var bars = h('div', { class: 'vbars' });
    VK.forEach(function (k) {
      var v = p.virtues[k], pct = Math.max(6, Math.min(100, (v - 1) / 4 * 100));
      bars.appendChild(h('div', { class: 'vbar' + (k === pr.typeKey ? ' best' : ''), title: k + (ui.detail ? ' ' + fmt(v, 2) : '') }, h('i', null, h('b', { style: 'height:' + pct + '%' })), k + (ui.detail ? ' ' + fmt(v, 1) : '')));
    });
    el.appendChild(bars);
    if (ui.detail) el.appendChild(h('div', { class: 'num', text: 'PAPS ' + fmt(p.papsPoints, 0) + '점 (' + p.papsGrade + '등급) · 인성 평균 ' + fmt(pr.virtueMean, 2) }));
    if (draft.mode === 'credit') el.appendChild(h('div', { class: 'cost' }, '💎 ' + draft.costs[id], h('small', { text: ' 크레딧' })));
    if (opts.why) el.appendChild(h('div', { class: 'why', text: opts.why }));
    if (!opts.disabled && opts.onpick) el.addEventListener('click', function () { opts.onpick(id, el); });
    return el;
  }

  function renderPool() {
    var pool = clear($('#d-pool'));
    var cur = D.currentPick(draft);
    if (!cur) { renderDone(pool); return; }
    if (draft.mode === 'auto') {
      var box = h('div', { class: 'reveal' });
      if (ui.lastReveal && byId[ui.lastReveal]) {
        var c = card(ui.lastReveal, {}); c.classList.add('next-card'); box.appendChild(c);
        box.appendChild(h('div', { class: 'hint', text: draft.teamNames[draft.picks[draft.picks.length - 1].team] + ' 소속으로 공개되었습니다.' }));
      } else box.appendChild(h('div', { class: 'hint', text: '버튼을 누르면 ' + draft.teamNames[cur.team] + '의 다음 선수가 공개됩니다. (Space)' }));
      box.appendChild(h('div', { class: 'actions', style: 'display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center' },
        h('button', { class: 'btn primary big', type: 'button', onclick: function () { revealNext(); } }, '다음 선수 공개 ▶'),
        h('button', { class: 'btn', type: 'button', onclick: toggleAutoplay }, ui.autoplay ? '⏸ 자동 공개 멈춤' : '▶ 자동 공개'),
        h('button', { class: 'btn ghost', type: 'button', onclick: function () { stopAutoplay(); while (!D.isDone(draft)) D.pick(draft, null, prepared); ui.lastReveal = null; persist(); render(); } }, '전체 공개')));
      pool.appendChild(box);
      return;
    }
    var cand = D.candidates(draft, prepared);
    var elig = {}; cand.ids.forEach(function (id) { elig[id] = true; });
    var picked = {}; draft.picks.forEach(function (p) { picked[p.id] = true; });
    var list;
    if (draft.mode === 'pick') list = draft.pools[cur.pool].filter(function (id) { return !picked[id]; });
    else list = prepared.map(function (p) { return p.id; }).filter(function (id) { return !picked[id]; }).sort(function (a, b) { return draft.costs[b] - draft.costs[a] || byId[b].papsPoints - byId[a].papsPoints; });
    if (!list.length) { pool.appendChild(h('div', { class: 'empty', text: '고를 수 있는 선수가 없습니다.' })); return; }
    if (draft.mode === 'pick') {
      /* 덕목 선택 칩: 원하는 성향의 선수 강조 */
      var counts = {}; list.forEach(function (id) { var k = prof[id].typeKey; counts[k] = (counts[k] || 0) + 1; });
      var chips = h('div', { class: 'chips' }, h('span', { class: 'hint', text: '덕목 고르기:' }));
      VK.forEach(function (k) {
        chips.appendChild(h('button', { class: 'chip-btn' + (ui.virtueFilter === k ? ' on' : '') + (counts[k] ? '' : ' none'), type: 'button',
          onclick: function () { ui.virtueFilter = ui.virtueFilter === k ? null : k; renderPool(); } }, D.VIRTUE_ICON[k] + ' ' + D.VIRTUE_TYPE[k] + (counts[k] ? ' ' + counts[k] : '')));
      });
      if (ui.virtueFilter) chips.appendChild(h('button', { class: 'chip-btn', type: 'button', onclick: function () { ui.virtueFilter = null; renderPool(); } }, '전체 보기'));
      pool.appendChild(chips);
      list = list.slice().sort(function (a, b) { return (ui.virtueFilter ? ((prof[b].typeKey === ui.virtueFilter) - (prof[a].typeKey === ui.virtueFilter)) : 0) || VK.indexOf(prof[a].typeKey) - VK.indexOf(prof[b].typeKey); });
    }
    if (cand.forced) pool.appendChild(h('div', { class: 'empty', style: 'color:var(--danger)', text: '예산 안에서 고를 수 있는 선수가 없어 예산을 초과해 지명합니다.' }));
    else if (cand.loose) pool.appendChild(h('div', { class: 'empty', style: 'color:var(--gold)', text: '어떤 선수를 골라도 크레딧이 조금 남게 됩니다.' }));
    list.forEach(function (id, i) {
      var c = card(id, { index: i, disabled: !elig[id], why: elig[id] ? null : cand.reasons[id], forced: cand.forced, onpick: doPick });
      if (ui.virtueFilter && prof[id].typeKey !== ui.virtueFilter) c.classList.add('dim');
      pool.appendChild(c);
    });
  }

  function renderBoards() {
    var box = clear($('#d-boards'));
    var cur = D.currentPick(draft);
    for (var t = 0; t < draft.K; t++) (function (t) {
      var b = h('div', { class: 'board' + (cur && cur.team === t ? ' active' : ''), style: '--team:' + color(t), dataset: { team: t } });
      b.appendChild(h('div', { class: 'board-head' }, h('b', { text: draft.teamNames[t] }), h('span', { class: 'cnt', text: draft.teams[t].length + ' / ' + draft.slots[t] + '명' })));
      if (draft.mode === 'credit') {
        var left = draft.budgets[t] - draft.spent[t], pct = draft.budgets[t] ? Math.round(draft.spent[t] / draft.budgets[t] * 100) : 0;
        b.appendChild(h('div', { class: 'budget' }, '💎 ' + draft.spent[t] + ' / ' + draft.budgets[t] + ' 사용 · 남음 ' + left, h('div', { class: 'bar' }, h('i', { style: 'width:' + pct + '%' }))));
      }
      var ul = h('ul', { class: 'members' });
      var lastPick = draft.picks.length ? draft.picks[draft.picks.length - 1] : null;
      draft.teams[t].forEach(function (id, i) {
        var p = byId[id], pr = prof[id];
        if (!p) return;
        var isNew = lastPick && lastPick.id === id;
        ul.appendChild(h('li', { class: 'member' + (isNew ? ' new' : '') + (ui.revealAnim ? ' reveal' : ''), style: 'animation-delay:' + (ui.revealAnim ? (t * 120 + i * 90) : (isNew ? 0 : i * 40)) + 'ms', title: ui.detail ? ('PAPS ' + fmt(p.papsPoints, 0) + '점 · ' + VK.map(function (k) { return k + ' ' + fmt(p.virtues[k], 1); }).join(' ')) : '' },
          h('span', { class: 'mini', style: 'background:' + color(t), text: avatarText(p) }),
          h('span', { class: 'nm', text: labelOf(p) }),
          h('span', { class: 'tg', text: pr.icon + (draft.mode === 'credit' ? ' 💎' + draft.costs[id] : '') })));
      });
      for (var s = draft.teams[t].length; s < draft.slots[t]; s++) ul.appendChild(h('li', { class: 'member slot', text: '빈 자리' }));
      b.appendChild(ul);
      if (draft.teams[t].length) {
        var ms = draft.teams[t].map(function (id) { return byId[id]; }).filter(Boolean);
        var mp = ms.reduce(function (a, p) { return a + p.papsPoints; }, 0) / ms.length;
        var types = {}; ms.forEach(function (p) { var k = prof[p.id].typeKey; types[k] = (types[k] || 0) + 1; });
        var foot = h('div', { class: 'board-foot' }, h('span', { text: '남 ' + ms.filter(function (p) { return p.gender === '남'; }).length + ' 여 ' + ms.filter(function (p) { return p.gender === '여'; }).length }),
          h('span', { text: VK.filter(function (k) { return types[k]; }).map(function (k) { return D.VIRTUE_ICON[k] + types[k]; }).join(' ') }));
        if (ui.detail) foot.appendChild(h('span', { text: '체력 평균 ' + fmt(mp, 1) }));
        b.appendChild(foot);
      }
      box.appendChild(b);
    })(t);
  }

  function renderDone(pool) {
    var sm = D.summary(draft);
    var banner = h('div', { class: 'done-banner' }, h('h2', { text: '🎉 ' + MODE_LABEL[draft.mode] + ' 완료' }));
    var stats = h('div', { class: 'stats' }, h('span', { text: '팀 ' + draft.K + '개 · 선수 ' + sm.picks + '명' }));
    if (draft.mode === 'credit') {
      var txt = '총 크레딧 ' + sm.totalBudget;
      if (!sm.unused && !sm.over) txt += ' — 모든 팀이 정확히 소진! 💯';
      else {
        if (sm.unused) txt += ' · 미사용 ' + sm.unused + ' (' + sm.leftover.map(function (l, t) { return l > 0 ? draft.teamNames[t] + ' ' + l : null; }).filter(Boolean).join(', ') + ')';
        if (sm.over) txt += ' · 초과 ' + sm.over + ' (' + sm.leftover.map(function (l, t) { return l < 0 ? draft.teamNames[t] + ' ' + (-l) : null; }).filter(Boolean).join(', ') + ')';
      }
      stats.appendChild(h('span', { text: txt }));
    }
    if (prepared.length) {
      var stt = A.evaluateTeams(prepared, draft.teams);
      stats.appendChild(h('span', { text: '공정성 점수 ' + stt.equity + ' · PAPS 팀 평균 범위 ' + fmt(stt.Dp, 1) + '점' }));
    }
    banner.appendChild(stats);
    banner.appendChild(h('div', { class: 'actions' },
      draft.anonymous && !ui.revealNames ? h('button', { class: 'btn primary big', type: 'button', onclick: revealNames }, '🎭 이름 공개하기') : null,
      h('button', { class: 'btn' + (draft.anonymous && !ui.revealNames ? '' : ' primary') + ' big', type: 'button', onclick: finish }, '결과 저장하고 메인에서 보기'),
      h('button', { class: 'btn', type: 'button', onclick: function () { ui.detail = !ui.detail; $('#d-detail').checked = ui.detail; render(); } }, ui.detail ? '점수 숨기기' : '팀 균형 점수 보기')));
    pool.appendChild(banner);
    if (!ui.confettiDone) { confetti(); ui.confettiDone = true; }
  }

  /* ---------- 동작 ---------- */
  function revealNames() {
    ui.revealNames = true; ui.revealAnim = true;
    $('#d-reveal').checked = true;
    render();
    setTimeout(function () { ui.revealAnim = false; }, 50);
  }
  function doPick(id, fromEl) {
    var cur = D.currentPick(draft);
    if (!cur) return;
    var r = D.pick(draft, id, prepared);
    if (!r.ok) { toast(r.error, true); return; }
    ui.virtueFilter = null;
    persist();
    flyTo(fromEl, r.team, byId[id]);
    render();
    if (D.isDone(draft)) stopTimer(); else resetTimer();
  }
  function flyLabel(p) { return p ? labelOf(p) : ''; }
  function revealNext() {
    var cur = D.currentPick(draft);
    if (!cur) { stopAutoplay(); return; }
    var r = D.pick(draft, null, prepared);
    if (!r.ok) return;
    ui.lastReveal = cur.id;
    persist(); render();
    var c = $('#d-pool .next-card');
    if (c) flyTo(c, r.team, byId[cur.id], 500);
    if (D.isDone(draft)) stopAutoplay();
  }
  function toggleAutoplay() { if (ui.autoplay) stopAutoplay(); else { ui.autoplay = setInterval(revealNext, 1900); revealNext(); } render(); }
  function stopAutoplay() { if (ui.autoplay) { clearInterval(ui.autoplay); ui.autoplay = null; } }

  function flyTo(fromEl, team, p, delay) {
    try {
      var board = $('.board[data-team="' + team + '"]');
      if (!fromEl || !board) return;
      var a = fromEl.getBoundingClientRect(), bh = $('.board-head', board).getBoundingClientRect();
      var fly = h('div', { class: 'fly', text: flyLabel(p) });
      fly.style.left = a.left + 'px'; fly.style.top = a.top + 'px'; fly.style.width = a.width + 'px'; fly.style.height = a.height + 'px';
      document.body.appendChild(fly);
      setTimeout(function () {
        var dx = bh.left + bh.width / 2 - (a.left + a.width / 2), dy = bh.top + bh.height / 2 - (a.top + a.height / 2);
        fly.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.25)'; fly.style.opacity = '0';
      }, delay || 20);
      setTimeout(function () { if (fly.parentNode) fly.parentNode.removeChild(fly); }, (delay || 20) + 700);
    } catch (e) { /* 애니메이션 실패해도 진행 */ }
  }

  function autoPick() {
    if (draft.mode === 'auto') { revealNext(); return; }
    var id = D.autoPick(draft, prepared);
    if (!id) { toast('고를 수 있는 선수가 없습니다.', true); return; }
    var el = $('#d-pool .card[data-id="' + id + '"]');
    doPick(id, el);
    toast('자동 지명: ' + labelOf(byId[id]));
  }
  function undo() {
    stopAutoplay();
    if (!D.undo(draft)) return;
    ui.lastReveal = null; persist(); render(); resetTimer();
  }
  function restart() {
    if (!confirm('드래프트를 처음부터 다시 할까요? 지금까지의 지명이 지워집니다.')) return;
    stopAutoplay(); stopTimer();
    draft = null;
    St.update(function (s) { s.draft = null; }, { noUndo: true }); St.persistNow();
    showSetup();
  }
  function finish() {
    if (!D.isDone(draft)) {
      var left = draft.sequence.length - draft.cursor;
      if (!confirm('아직 ' + left + '명이 남았습니다. 남은 선수를 자동으로 배정하고 저장할까요?')) return;
      D.fillRemaining(draft, prepared);
    }
    stopAutoplay(); stopTimer();
    var mode = draft.mode;
    St.update(function (s) {
      s.result = { teams: draft.teams.map(function (t) { return t.slice(); }), seed: draft.seed, log: [MODE_LABEL[mode] + ' 결과입니다.'], builtAt: new Date().toISOString(), source: 'draft', mode: mode };
      s.manualEdits = false; s.teamNames = draft.teamNames.slice(); s.draft = draft;
    }, { noUndo: true });
    St.persistNow();
    toast('저장했습니다. 메인 화면 4단계에서 확인할 수 있습니다.');
    setTimeout(function () { location.href = 'index.html#sec-result'; }, 900);
  }

  /* ---------- 타이머 ---------- */
  function resetTimer() {
    stopTimer();
    if (!draft || !draft.timerSec || D.isDone(draft) || draft.mode === 'auto') { $('#d-timer-view').hidden = true; return; }
    ui.timerLeft = draft.timerSec;
    $('#d-timer-view').hidden = false; updateTimer();
    ui.timer = setInterval(function () {
      ui.timerLeft--; updateTimer();
      if (ui.timerLeft <= 0) { stopTimer(); toast('시간 초과 — 자동 지명'); autoPick(); }
    }, 1000);
  }
  function stopTimer() { if (ui.timer) { clearInterval(ui.timer); ui.timer = null; } }
  function updateTimer() {
    var v = $('#d-timer-view');
    if (!draft || !draft.timerSec || draft.mode === 'auto' || D.isDone(draft)) { v.hidden = true; return; }
    v.hidden = false; $('#d-timer-num').textContent = ui.timerLeft + '초'; v.classList.toggle('warn', ui.timerLeft <= 5);
  }

  function confetti() {
    var box = clear($('#d-confetti')); box.hidden = false;
    for (var i = 0; i < 60; i++) {
      var c = h('i', { style: 'left:' + (Math.random() * 100) + 'vw;background:' + COLORS[i % COLORS.length] + ';animation-duration:' + (2.2 + Math.random() * 2) + 's;animation-delay:' + (Math.random() * .8) + 's;transform:rotate(' + (Math.random() * 360) + 'deg)' });
      box.appendChild(c);
    }
    setTimeout(function () { box.hidden = true; clear(box); }, 5000);
  }

  function bindStage() {
    $('#d-detail').addEventListener('change', function (e) { ui.detail = e.target.checked; render(); });
    $('#d-reveal').addEventListener('change', function (e) { if (e.target.checked) revealNames(); else { ui.revealNames = false; ui.revealAnim = false; render(); } });
    $('#d-auto').addEventListener('click', autoPick);
    $('#d-undo').addEventListener('click', undo);
    $('#d-restart').addEventListener('click', restart);
    $('#d-finish').addEventListener('click', finish);
    document.addEventListener('keydown', function (e) {
      if (!draft || /input|textarea|select/i.test(document.activeElement.tagName)) return;
      if (e.key === ' ' || e.key === 'Enter') { if (draft.mode === 'auto') { e.preventDefault(); revealNext(); } }
      else if (e.key.toLowerCase() === 'a') autoPick();
      else if (e.key.toLowerCase() === 'z') undo();
    });
    window.addEventListener('beforeunload', function () { stopAutoplay(); stopTimer(); });
  }

  function init() {
    bindSetup(); bindStage(); load();
    if (draft && draft.status === 'running') resetTimer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  root.AgoraDraftUI = { reload: load };
})(window);
