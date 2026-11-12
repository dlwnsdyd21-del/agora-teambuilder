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
  function svgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  /* 유니폼(저지) 아이콘: 몸판 색 + 등번호 */
  function jersey(text, color, cls) {
    var s = String(text === null || text === undefined ? '' : text);
    var fs = s.length >= 3 ? 20 : s.length === 2 ? 25 : 28;
    var dark = 'rgba(0,0,0,.28)';
    return svgEl('svg', { class: 'jersey ' + (cls || ''), viewBox: '0 0 64 64', 'aria-hidden': 'true' },
      svgEl('path', { d: 'M21 5 L29 9 Q32 14 35 9 L43 5 L60 13 L55 27 L48 24 L48 58 Q48 60 46 60 L18 60 Q16 60 16 58 L16 24 L9 27 L4 13 Z', fill: color, stroke: dark, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
      svgEl('path', { d: 'M29 9 Q32 14 35 9 Q32 18 29 9 Z', fill: dark }),
      svgEl('path', { d: 'M4 13 L9 27 L16 24 L16 19 Z M60 13 L55 27 L48 24 L48 19 Z', fill: 'rgba(255,255,255,.18)' }),
      svgEl('text', { x: 32, y: 44, 'text-anchor': 'middle', 'font-size': fs, 'font-weight': 800, fill: '#fff', 'font-family': 'Pretendard, Noto Sans KR, system-ui, sans-serif', stroke: 'rgba(0,0,0,.25)', 'stroke-width': 1.2, 'paint-order': 'stroke' }, s));
  }
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
  function isPinned(p) { return !!(draft && draft.pinned && draft.pinned[p.id] !== undefined); }
  /* 팀 t 의 주장(학생 객체) 또는 null */
  function captainOf(t) { var id = draft && draft.captains ? draft.captains[t] : null; return (id !== null && id !== undefined && byId[id]) || null; }
  /* 팀 고정 학생은 익명 모드에서도 실명 */
  function labelOf(p) { return (showNames() || isPinned(p)) ? (p.name || '(이름 없음)') : (draft.codes && draft.codes[p.id]) || '선수'; }
  function avatarText(p) {
    if (showNames() || isPinned(p)) return p.no !== null && p.no !== undefined ? p.no : '?';
    var c = draft.codes && draft.codes[p.id]; return c ? c.replace(/\D/g, '') : '?';
  }

  function persist() { St.update(function (s) { s.draft = draft; }, { noUndo: true }); St.persistNow(); }

  function load() {
    St.load();
    session = St.get();
    /* 결석·활동 제한·기록/심판 학생은 오늘 편성에서 제외 */
    prepared = S.prepareStudents(St.activeStudents(session), session.options);
    byId = {}; prepared.forEach(function (p) { byId[p.id] = p; });
    prof = D.profiles(prepared);
    var inactiveN = St.inactiveStudents(session).length;
    $('#d-class').textContent = (session.classLabel ? session.classLabel + ' 학급 · ' : '') + prepared.length + '명' + (inactiveN ? ' (불참 ' + inactiveN + ')' : '');
    var d = session.draft;
    var ids = prepared.map(function (p) { return p.id; }).sort().join('|');
    if (d && d.sequence && d.studentKey === ids && (d.status === 'running' || d.status === 'done')) { draft = d; showStage(); }
    else { draft = null; showSetup(); }
  }

  /* ============================================================ 준비 화면 */
  function showSetup() {
    $('#d-main').classList.remove('side');
    $('#d-setup').hidden = false; $('#d-stage').hidden = true; $('#d-boards').hidden = true; $('#d-controls').hidden = true;
    $('#d-mode').textContent = '준비';
    var o = session.options;
    ui.mode = o.draftMode || 'pick'; ui.seed = (o.seed | 0) || 1;
    $$('.mode-card').forEach(function (b) { b.classList.toggle('selected', b.dataset.mode === ui.mode); });
    $('#d-teamCount').value = o.teamCount || 6;
    $('#d-gender').checked = !!o.genderBalance;
    $('#d-split').checked = !!o.genderSeparate;
    $('#d-teamCountM').value = o.teamCountM || Math.max(1, Math.round((o.teamCount || 6) / 2));
    $('#d-teamCountF').value = o.teamCountF || Math.max(1, Math.round((o.teamCount || 6) / 2));
    $('#d-weight').value = typeof o.creditFitnessWeight === 'number' ? o.creditFitnessWeight : 0.6;
    $('#d-weight-val').textContent = Math.round($('#d-weight').value * 100) + '%';
    $('#d-timer').checked = !!(o.draftTimerSec > 0);
    if (o.draftTimerSec > 0) $('#d-timer-sec').value = o.draftTimerSec;
    $('#d-anon').checked = o.draftAnonymous !== false;
    try { $('#d-adv').open = localStorage.getItem('agora.ui.detail') === '1'; } catch (e) { /* ignore */ }
    var pinnedN = Object.keys(session.options.pinned || {}).filter(function (id) { return byId[id]; }).length;
    /* 자료 누락 경고 (학급 평균으로 대체된 학생이 많으면 균등화의 의미가 줄어듦) */
    var missV = prepared.filter(function (p) { return p.virtueImputed; }).length, missP = prepared.filter(function (p) { return p.papsImputed; }).length;
    var warnEl = $('#d-missing-warn');
    if (warnEl) {
      var ratio = prepared.length ? Math.max(missV, missP) / prepared.length : 0;
      warnEl.hidden = !(missV || missP);
      warnEl.textContent = (missV || missP) ? ('⚠ 자료가 없어 학급 평균으로 채운 학생: 인성 ' + missV + '명 · PAPS ' + missP + '명 (' + Math.round(ratio * 100) + '%). ' + (ratio >= 0.2 ? '누락이 많아 균형 수치가 실제보다 좋게 보입니다. 설문 재실시 또는 수동 배치를 권장합니다.' : '해당 학생은 어느 팀에 가도 균형 수치를 바꾸지 않습니다.')) : '';
    }
    $('#d-setup-info').textContent = prepared.length ? ('학생 ' + prepared.length + '명 (남 ' + prepared.filter(function (p) { return p.gender === '남'; }).length + ' · 여 ' + prepared.filter(function (p) { return p.gender === '여'; }).length + ')' + (pinnedN ? ' · 팀 고정 ' + pinnedN + '명은 해당 팀에 미리 배치됩니다(실명 표시)' : '') + '. 방식을 고르고 시작하세요.') : '학생 자료가 없습니다. 메인 화면 1단계에서 자료를 불러온 뒤 다시 여세요.';
    $('#d-start').disabled = !prepared.length;
    /* 팀 주장: 지난번에 정한 주장을 이어받음 (명단에 없는·불참 학생은 제외) */
    ui.captains = {};
    Object.keys(o.captains || {}).forEach(function (t) { if (byId[o.captains[t]]) ui.captains[t] = o.captains[t]; });
    /* 새로운 조합: 지난 편성이 있을 때만 (기본 켬) */
    ui.hasPast = St.pastTeams(session).length > 0;
    $('#d-mix').checked = ui.hasPast;
    renderNames(); renderCaptains(); renderOrder(); updateModeUI();
  }
  /* ---------- 팀 주장 지정 ---------- */
  function genderOf(p) { return p.gender === '여' ? '여' : '남'; }
  /* 팀 수·남녀 따로 설정이 바뀌면 맞지 않는 주장을 걷어냄. 반환: {팀 번호: 학생 id} */
  function validCaptains() {
    var K = totalTeams(), sp = currentSplit(), out = {}, used = {};
    Object.keys(ui.captains || {}).forEach(function (tk) {
      var t = parseInt(tk, 10), id = ui.captains[tk], p = byId[id];
      if (!p || isNaN(t) || t < 0 || t >= K || used[id]) return;
      if (sp && genderOf(p) !== (t < sp['남'] ? '남' : '여')) return;
      out[t] = id; used[id] = true;
    });
    return out;
  }
  function renderCaptains() {
    var box = clear($('#d-captains'));
    var K = totalTeams(), sp = currentSplit(), names = currentNames();
    ui.captains = validCaptains();
    var teamOfCap = {}; Object.keys(ui.captains).forEach(function (t) { teamOfCap[ui.captains[t]] = +t; });
    var sorted = prepared.slice().sort(function (a, b) {
      var x = a.no !== null && a.no !== undefined ? a.no : 1e9, y = b.no !== null && b.no !== undefined ? b.no : 1e9;
      return x - y || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
    for (var t = 0; t < K; t++) (function (t) {
      if (sp && (t === 0 || t === sp['남'])) box.appendChild(h('div', { class: 'group-title', text: t === 0 ? '남자 팀' : '여자 팀' }));
      var tg = sp ? (t < sp['남'] ? '남' : '여') : null;
      var sel = h('select', { 'data-team': t, 'aria-label': names[t] + ' 주장', onchange: function (e) {
        if (e.target.value) ui.captains[t] = e.target.value; else delete ui.captains[t];
        renderCaptains(); renderOrder();
      } }, h('option', { value: '', text: '— 주장 없음 —' }));
      sorted.forEach(function (p) {
        if (tg && genderOf(p) !== tg) return;
        var other = teamOfCap[p.id] !== undefined && teamOfCap[p.id] !== t;
        sel.appendChild(h('option', { value: p.id, selected: ui.captains[t] === p.id, disabled: other,
          text: (p.no !== null && p.no !== undefined ? p.no + ' ' : '') + (p.name || '(이름 없음)') + (p.gender ? ' (' + p.gender + ')' : '') + (other ? ' — ' + names[teamOfCap[p.id]] + ' 주장' : '') }));
      });
      box.appendChild(h('label', { class: ui.captains[t] ? 'set' : '' }, h('i', { style: 'background:' + color(t) }), h('span', { class: 'tn', text: names[t] }), sel));
    })(t);
    var n = Object.keys(ui.captains).length;
    $('#d-cap-info').textContent = n ? n + ' / ' + K + '팀 지정' + (n < K ? ' — 나머지 팀은 주장 없이 진행' : '') : '아직 지정한 주장이 없습니다';
    $('#d-cap-clear').disabled = !n;
  }
  /* 남녀 따로 설정값: {남: Km, 여: Kf} 또는 null */
  function currentSplit() {
    if (!$('#d-split').checked) return null;
    return { 남: Math.max(1, parseInt($('#d-teamCountM').value, 10) || 1), 여: Math.max(1, parseInt($('#d-teamCountF').value, 10) || 1) };
  }
  function totalTeams() { var sp = currentSplit(); return sp ? sp['남'] + sp['여'] : Math.max(1, parseInt($('#d-teamCount').value, 10) || 6); }
  function updateModeUI() {
    $('#d-weight-wrap').style.display = ui.mode === 'credit' ? '' : 'none';
    $('#d-anon-wrap').style.display = ui.mode === 'auto' ? 'none' : '';
    $('#d-captains-wrap').hidden = ui.mode === 'auto' || !prepared.length;
    $('#d-mix-wrap').hidden = !(ui.mode === 'auto' && ui.hasPast);
    var sp = currentSplit();
    $('#d-split-counts').hidden = !sp;
    $('#d-teamCount-wrap').style.display = sp ? 'none' : '';
    $('#d-gender-wrap').style.display = sp ? 'none' : '';
    var warn = '';
    if (ui.mode === 'auto') warn = '시작하면 메인 3단계 설정(허용편차·제약 조건 포함)으로 팀을 새로 편성해 한 명씩 공개합니다.' + (ui.hasPast ? ($('#d-mix').checked ? ' "새로운 조합"이 켜져 있어 지난 편성에서 같은 팀이었던 학생들이 되도록 다시 만나지 않게 짭니다(팀 평균은 비슷하게 유지).' : ' "새로운 조합"을 켜면 지난 편성과 덜 겹치는 팀으로 짭니다.') : ' 다른 조합을 원하면 🎲 순서 추첨을 다시 누르세요.');
    if (ui.mode !== 'auto' && prepared.some(function (p) { return !p.gender; }) && $('#d-gender').checked && !sp) warn = '성별이 없는 학생은 별도 풀(미상)로 지명됩니다. 메인 명단에서 성별을 채우면 더 정확합니다.';
    if (sp) {
      var nm = prepared.filter(function (p) { return p.gender === '남'; }).length, nf = prepared.filter(function (p) { return p.gender === '여'; }).length, nu = prepared.length - nm - nf;
      warn = '남학생 ' + nm + '명 → 남자 팀 ' + sp['남'] + '개(팀당 ' + (sp['남'] ? Math.floor(nm / sp['남']) + (nm % sp['남'] ? '~' + Math.ceil(nm / sp['남']) : '') : 0) + '명) · 여학생 ' + nf + '명 → 여자 팀 ' + sp['여'] + '개(팀당 ' + (sp['여'] ? Math.floor(nf / sp['여']) + (nf % sp['여'] ? '~' + Math.ceil(nf / sp['여']) : '') : 0) + '명). 팀 간 균형은 같은 성별 안에서 맞춥니다.'
        + (nu ? ' ⚠ 성별 미상 ' + nu + '명 — 메인 명단에서 성별을 채워야 시작할 수 있습니다.' : '');
    }
    $('#d-setup-warn').textContent = warn;
    $('#d-start').disabled = !prepared.length || !!(sp && prepared.some(function (p) { return !p.gender; }));
  }
  function renderNames() {
    var K = totalTeams(), sp = currentSplit();
    var names = (session.teamNames || []).slice();
    var sameMode = !!session.result && !!session.result.split === !!sp;   // 설정이 바뀌면 저장된 이름 대신 기본 이름
    var box = clear($('#d-names'));
    for (var t = 0; t < K; t++) {
      if (sp && (t === 0 || t === sp['남'])) box.appendChild(h('div', { class: 'group-title', text: t === 0 ? '남자 팀' : '여자 팀' }));
      var def = A.teamLabel(t, sp);
      box.appendChild(h('label', null, h('i', { style: 'background:' + color(t) }), h('input', { type: 'text', value: (sameMode || !session.result) && names[t] ? names[t] : def, placeholder: def, 'data-team': t, maxlength: 12 })));
    }
  }
  function currentNames() {
    var sp = currentSplit();
    return $$('#d-names input').map(function (inp, t) { return inp.value.trim() || A.teamLabel(t, sp); });
  }
  function renderOrder() {
    var K = totalTeams(), sp = currentSplit();
    var names = currentNames();
    var box = clear($('#d-order'));
    try {
      var st = D.initDraft(prepared.slice(0, 1), { mode: 'credit', teamCount: K, split: sp, seed: ui.seed, teamNames: names });
      /* 주장을 정한 팀은 순서 칩에 주장 이름도 함께 (누가 지명하는지 보이도록) */
      var caps = ui.mode === 'auto' ? {} : (ui.captains || {});
      var chipText = function (t, i) { var c = byId[caps[t]]; return (i + 1) + '. ' + names[t] + (c ? ' 👑 ' + (c.name || '') : ''); };
      if (sp) {
        ['남', '여'].forEach(function (g) {
          box.appendChild(h('span', { class: 'hint', text: (g === '남' ? '남자 팀' : '여자 팀') + ' 1라운드 순서: ' }));
          st.orderG[g].forEach(function (t, i) { box.appendChild(h('span', { class: 'chip', style: 'background:' + color(t) + ';animation-delay:' + (i * 90) + 'ms', text: chipText(t, i) })); });
        });
      } else {
        box.appendChild(h('span', { class: 'hint', text: '1라운드 순서: ' }));
        st.order.forEach(function (t, i) { box.appendChild(h('span', { class: 'chip', style: 'background:' + color(t) + ';animation-delay:' + (i * 90) + 'ms', text: chipText(t, i) })); });
      }
    } catch (e) { box.appendChild(h('span', { class: 'hint', text: e.message })); }
  }
  function bindSetup() {
    $$('.mode-card').forEach(function (b) { b.addEventListener('click', function () { ui.mode = b.dataset.mode; $$('.mode-card').forEach(function (x) { x.classList.toggle('selected', x === b); }); updateModeUI(); renderOrder(); }); });
    $('#d-teamCount').addEventListener('change', function () { renderNames(); renderCaptains(); renderOrder(); });
    ['#d-split', '#d-teamCountM', '#d-teamCountF'].forEach(function (sel) { $(sel).addEventListener('change', function () { updateModeUI(); renderNames(); renderCaptains(); renderOrder(); }); });
    $('#d-gender').addEventListener('change', updateModeUI);
    $('#d-mix').addEventListener('change', updateModeUI);
    $('#d-weight').addEventListener('input', function (e) { $('#d-weight-val').textContent = Math.round(e.target.value * 100) + '%'; });
    $('#d-lottery').addEventListener('click', function () { ui.seed = 1 + Math.floor(Math.random() * 1e6); renderOrder(); });
    $('#d-names').addEventListener('input', function () { renderOrder(); });
    $('#d-names').addEventListener('change', renderCaptains);   // 팀 이름을 바꾸면 주장 칸의 팀 이름도 갱신
    $('#d-cap-clear').addEventListener('click', function () { ui.captains = {}; renderCaptains(); renderOrder(); });
    $('#d-start').addEventListener('click', start);
  }

  function start() {
    var sp = currentSplit();
    var K = totalTeams();
    if (prepared.length < K) { toast('학생 수보다 팀 수가 많습니다.', true); return; }
    if (sp) {
      var nm = prepared.filter(function (p) { return p.gender === '남'; }).length, nf = prepared.filter(function (p) { return p.gender === '여'; }).length;
      if (prepared.length - nm - nf > 0) { toast('성별 미상 학생이 있어 남녀 따로 편성할 수 없습니다. 메인 명단에서 성별을 채워 주세요.', true); return; }
      if (nm < sp['남'] || nf < sp['여']) { toast('남학생 ' + nm + '명 / 여학생 ' + nf + '명보다 팀 수가 많습니다.', true); return; }
    }
    var names = currentNames();
    var genderBalance = !sp && $('#d-gender').checked;
    var weight = parseFloat($('#d-weight').value);
    var timerSec = $('#d-timer').checked ? Math.max(5, parseInt($('#d-timer-sec').value, 10) || 30) : 0;
    var autoTeams = null, mixNote = '';
    if (ui.mode === 'auto') {
      /* 시작할 때마다 현재 설정(팀 수·성별 균형·허용편차·제약)과 추첨 시드로 새로 편성.
       * "새로운 조합"이 켜져 있으면 지난 편성에서 같은 팀이었던 짝이 덜 겹치게 (매번 다른 시드) */
      var past = (ui.hasPast && $('#d-mix').checked) ? St.pastTeams(session) : [];
      if (past.length) ui.seed = 1 + Math.floor(Math.random() * 1e6);
      var res = A.buildTeams(prepared, Object.assign({}, session.options, { teamCount: K, genderBalance: genderBalance, genderSeparate: !!sp, teamCountM: sp ? sp['남'] : 0, teamCountF: sp ? sp['여'] : 0, seed: ui.seed, avoid: past }));
      autoTeams = res.teams;
      if (past.length) {
        var shp = A.sharedPairs(past[0], res.teams);
        mixNote = '새로운 조합으로 편성했습니다 — 지난 편성과 같은 팀인 짝은 ' + shp.total + '쌍 중 ' + shp.shared + '쌍입니다.';
      }
      if (res.log && res.log.length) toast(res.log[0]); else if (mixNote) toast(mixNote);
    }
    var anonymous = ui.mode !== 'auto' && $('#d-anon').checked;
    var captains = ui.mode === 'auto' ? {} : validCaptains();
    try {
      draft = D.initDraft(prepared, { mode: ui.mode, teamCount: K, split: sp, genderBalance: genderBalance, seed: ui.seed, fitnessWeight: weight, teamNames: names, autoTeams: autoTeams, anonymous: anonymous, pinned: session.options.pinned || {}, captains: captains });
    } catch (e) { toast(e.message, true); return; }
    draft.studentKey = prepared.map(function (p) { return p.id; }).sort().join('|');
    draft.timerSec = timerSec;
    draft.mixNote = mixNote;
    St.update(function (s) {
      s.draft = draft; s.teamNames = names;
      if (ui.mode !== 'auto') s.options.captains = captains;
      s.options.draftMode = ui.mode; s.options.teamCount = sp ? s.options.teamCount : K; s.options.genderBalance = sp ? s.options.genderBalance : genderBalance; s.options.creditFitnessWeight = weight; s.options.draftTimerSec = timerSec;
      s.options.genderSeparate = !!sp; if (sp) { s.options.teamCountM = sp['남']; s.options.teamCountF = sp['여']; }
      s.options.draftAnonymous = $('#d-anon').checked;
    }, { noUndo: true });
    St.persistNow();
    ui.confettiDone = false; ui.revealNames = false; ui.revealAnim = false;
    ui.lastReveal = null; ui.virtueFilter = null;   // 이전 편성의 공개 카드·덕목 선택이 새 편성에 남지 않도록
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
    /* 진행 중 + 넓은 화면: 선수 카드(왼쪽) 옆에 팀 보드(오른쪽)를 고정 — 지명하는 동안 팀 현황이 항상 보이도록. 완료 후에는 보드를 전체 폭으로 */
    $('#d-main').classList.toggle('side', !D.isDone(draft));
    $('#d-main').classList.toggle('wide-boards', draft.mode !== 'credit');   // 카드가 적은 방식은 보드 쪽을 더 넓게
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
      /* 지명 주체: 팀 주장이 있으면 주장, 없으면 미리 배치된(고정) 학생을 함께 표시 */
      var cap = captainOf(cur.team);
      var fixed = (draft.prePlaced || []).filter(function (id) { return draft.pinned[id] === cur.team && byId[id]; }).map(function (id) { return byId[id].name || id; });
      if (cap && draft.mode !== 'auto') now.appendChild(h('span', { class: 'sub cap', text: '👑 주장 ' + (cap.name || '') + ' 지명' }));
      else if (fixed.length && draft.mode !== 'auto') now.appendChild(h('span', { class: 'sub', text: '📌 ' + fixed.join(', ') + ' 지명' }));
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
    var el = h('div', { class: 'card' + (opts.disabled ? ' disabled' : '') + (opts.forced ? ' forced' : '') + (ui.revealAnim ? ' unmask' : ''), dataset: { id: id }, style: 'animation-delay:' + ((opts.index || 0) * 45) + 'ms' });
    el.appendChild(h('div', { class: 'top' },
      h('div', { class: 'avatar' }, jersey(avatarText(p), p.gender === '여' ? '#f0637f' : p.gender === '남' ? '#3b82f6' : '#64748b')),
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
      if (ui.lastReveal && byId[ui.lastReveal] && draft.picks.length) {
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
    /* 남녀 따로: 이 팀 성별의 선수만 보여 줌 */
    if (draft.split) list = list.filter(function (id) { return byId[id] && (byId[id].gender === '여' ? '여' : '남') === draft.teamGender[cur.team]; });
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
    /* 남녀 따로: 남자 팀 묶음과 여자 팀 묶음을 나란히(폭이 모자라면 위아래로) 배치 — 한 화면에 모두 보이도록 */
    box.classList.toggle('split', !!draft.split);
    box.classList.toggle('done', D.isDone(draft));
    /* 옆 배치(넓은 화면·진행 중)에서의 보드 줄 나눔과 글자 크기 계산용 값:
     * --rows 팀당 최대 인원, --cols 한 줄의 보드 수, --stack 세로로 쌓이는 보드 줄 수. 실제 보드 영역 폭으로 정함 */
    var K = draft.K, cols, stack, stackGroups = false, gcols = {};
    var sideOn = getComputedStyle($('#d-main')).display === 'grid';
    var minW = sideOn ? 178 : (window.innerWidth <= 760 ? 150 : 180);          // 보드 하나의 최소 폭
    var maxCols = box.clientWidth ? Math.max(1, Math.floor((box.clientWidth - 12) / (minW + 12))) : 99;
    /* 한 줄에 다 못 놓으면 줄 수를 정한 뒤 줄마다 고르게 (6팀 → 5+1 이 아니라 3+3) */
    var balance = function (k, pref) { var c = Math.max(1, Math.min(pref, maxCols, k)); return Math.ceil(k / Math.ceil(k / c)); };
    if (draft.split) {
      var km = draft.split['남'] | 0, kf = draft.split['여'] | 0;
      stackGroups = km > 0 && kf > 0 && (K > maxCols || (sideOn && K > 4));   // 나란히 못 놓으면 남자 팀 줄 / 여자 팀 줄로 쌓음
      gcols = { 남: km ? balance(km, km) : 1, 여: kf ? balance(kf, kf) : 1 };
      if (!stackGroups) gcols = { 남: Math.max(1, km), 여: Math.max(1, kf) };
      cols = stackGroups ? Math.max(gcols['남'], gcols['여']) : K;
      stack = stackGroups ? (km ? Math.ceil(km / gcols['남']) : 0) + (kf ? Math.ceil(kf / gcols['여']) : 0) : 1;
    } else {
      cols = balance(K, sideOn ? (K <= 4 ? K : Math.ceil(K / 2)) : K);
      stack = Math.ceil(K / cols);
    }
    box.classList.toggle('stack-groups', stackGroups);
    box.classList.toggle('credit', draft.mode === 'credit');
    /* --chrome: 보드 한 줄에서 선수 줄 말고 차지하는 높이(머리·예산·요약·그룹 제목) */
    box.style.setProperty('--chrome', (7.2 + (draft.mode === 'credit' ? 2.4 : 0) + (draft.split ? 2.7 : 0) + ((draft.captains || []).some(function (c) { return c !== null && c !== undefined; }) ? 1.8 : 0)) + 'rem');
    box.style.setProperty('--rows', Math.max.apply(null, draft.slots.concat([1])));
    box.style.setProperty('--cols', cols);
    box.style.setProperty('--stack', stack);
    var rows = {};
    if (draft.split) {
      [['남', '👦 남자 팀'], ['여', '👧 여자 팀']].forEach(function (g) {
        var k = draft.split[g[0]] | 0;
        if (!k) return;
        var n = 0; draft.slots.forEach(function (s, t) { if (draft.teamGender[t] === g[0]) n += s; });
        var row = h('div', { class: 'board-row', style: '--gcols:' + (gcols[g[0]] || k) });
        /* flex: 팀 수에 비례해 넓어지고, 팀당 최소 폭을 못 채우면 다음 줄로 */
        box.appendChild(h('section', { class: 'board-group', style: 'flex:' + (stackGroups ? '1 1 100%' : k + ' 1 0') },
          h('div', { class: 'group-title' }, g[1], h('span', { class: 'sub', text: k + '팀 · ' + n + '명' })), row));
        rows[g[0]] = row;
      });
    }
    for (var t = 0; t < draft.K; t++) (function (t) {
      var b = h('div', { class: 'board' + (cur && cur.team === t ? ' active' : ''), style: '--team:' + color(t), dataset: { team: t } });
      var capP = captainOf(t);
      b.appendChild(h('div', { class: 'board-head' }, h('b', { text: draft.teamNames[t] }), h('span', { class: 'cnt', text: draft.teams[t].length + ' / ' + draft.slots[t] + '명' })));
      if (capP) b.appendChild(h('div', { class: 'board-cap', title: '팀 주장 — 이 팀의 선수를 지명합니다' }, '👑 주장 ', h('b', { text: capP.name || '(이름 없음)' })));
      if (draft.mode === 'credit') {
        var left = draft.budgets[t] - draft.spent[t], pct = draft.budgets[t] ? Math.round(draft.spent[t] / draft.budgets[t] * 100) : 0;
        b.appendChild(h('div', { class: 'budget' }, '💎 ' + draft.spent[t] + ' / ' + draft.budgets[t] + ' 사용 · 남음 ' + left, h('div', { class: 'bar' }, h('i', { style: 'width:' + pct + '%' }))));
      }
      var ul = h('ul', { class: 'members' });
      var lastPick = draft.picks.length ? draft.picks[draft.picks.length - 1] : null;
      /* 진행 중에는 지명 순서, 완료 후에는 번호순 (지명 순서 = 체력 순이 드러나지 않도록) */
      var memberIds = draft.teams[t].slice();
      if (D.isDone(draft)) memberIds.sort(function (a, b) { var x = byId[a] && byId[a].no !== null ? byId[a].no : 1e9, y = byId[b] && byId[b].no !== null ? byId[b].no : 1e9; return x - y; });
      /* 주장은 항상 맨 위 */
      if (capP) memberIds.sort(function (a, b) { return (b === capP.id) - (a === capP.id); });
      memberIds.forEach(function (id, i) {
        var p = byId[id], pr = prof[id];
        if (!p) return;
        var isNew = lastPick && lastPick.id === id && !D.isDone(draft);
        var pinnedHere = isPinned(p), isCap = !!capP && capP.id === id;
        ul.appendChild(h('li', { class: 'member' + (isNew ? ' new' : '') + (ui.revealAnim && !pinnedHere ? ' unmask' : '') + (pinnedHere ? ' pinned' : '') + (isCap ? ' captain' : ''), style: 'animation-delay:' + (ui.revealAnim ? (t * 120 + i * 90) : (isNew ? 0 : i * 40)) + 'ms', title: (isCap ? '팀 주장' : pinnedHere ? '팀 고정 (미리 배치)' : '') + (ui.detail ? ('\nPAPS ' + fmt(p.papsPoints, 0) + '점 · ' + VK.map(function (k) { return k + ' ' + fmt(p.virtues[k], 1); }).join(' ')) : '') },
          h('span', { class: 'mini' }, jersey(avatarText(p), color(t), 'small')),
          h('span', { class: 'nm', text: labelOf(p) }),
          isCap ? h('span', { class: 'pin', text: '👑', title: '팀 주장' }) : pinnedHere ? h('span', { class: 'pin', text: '📌', title: '팀 고정' }) : null,
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
      ((draft.split && rows[draft.teamGender[t]]) || box).appendChild(b);
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
      var ev = A.evaluateGroups(prepared, draft.teams, draft.split);
      if (draft.split) stats.appendChild(h('span', { text: '공정성 점수 ' + ev.groups.map(function (g) { return g.label + ' ' + g.stats.equity + ' (PAPS 범위 ' + fmt(g.stats.Dp, 1) + '점)'; }).join(' · ') }));
      else stats.appendChild(h('span', { text: '공정성 점수 ' + ev.equity + ' · PAPS 팀 평균 범위 ' + fmt(ev.groups[0].stats.Dp, 1) + '점' }));
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
      var teams = draft.teams.map(function (t) { return t.slice(); });
      var log = [MODE_LABEL[mode] + ' 결과입니다.' + (draft.split ? ' 남자 팀 ' + draft.split['남'] + '개 · 여자 팀 ' + draft.split['여'] + '개로 따로 편성했습니다.' : '')];
      if (draft.mixNote) log.push(draft.mixNote);
      /* 바뀌기 전 결과는 지난 편성으로 남겨 둠 — 다음 "새로운 조합" 편성 때 같은 팀이 덜 겹치게 */
      St.rememberResult(s, teams);
      /* original: 편성 직후 상태 — 수동 조정 후 "편성 직후로 복원"에 사용 */
      s.result = { teams: teams, original: teams.map(function (t) { return t.slice(); }), seed: draft.seed, log: log, builtAt: new Date().toISOString(), source: 'draft', mode: mode, note: '', split: draft.split || null,
        captains: (draft.captains || []).slice() };
      s.manualEdits = false; s.teamNames = draft.teamNames.slice(); s.draft = draft;
    }, { noUndo: true });
    St.persistNow();
    toast('저장했습니다. 메인 화면 4단계에서 확인할 수 있습니다.');
    setTimeout(function () {
      /* 메인 창이 살아 있으면 그쪽으로 돌아가고 이 창은 닫음 (창이 두 개 쌓이지 않도록) */
      var op = null;
      try { op = window.opener && !window.opener.closed ? window.opener : null; } catch (e) { op = null; }
      if (op) {
        try { op.location.hash = '#sec-result'; op.focus(); } catch (e) { /* 다른 출처면 무시 */ }
        window.close();
        /* 브라우저가 닫기를 막은 경우에만 이 창을 메인으로 이동 */
        setTimeout(function () { if (!window.closed) location.href = 'index.html#sec-result'; }, 300);
      } else location.href = 'index.html#sec-result';
    }, 900);
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
    /* 창 크기가 바뀌면 보드 줄 나눔을 다시 계산 */
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (draft && !$('#d-stage').hidden) renderBoards(); }, 150);
    });
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
