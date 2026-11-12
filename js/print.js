/* ============================================================
 * print.js — 인쇄 미리보기와 인쇄물
 *  - 팀 명단(게시용) · 팀별 한 장씩 · 교사용(개인 점수 포함) · 저장된 모든 학급 명단
 *  - 미리보기 창에서 용지 방향·흑백·성별 표시·제목을 고르고 바로 인쇄 (PDF 저장도 인쇄 창에서)
 *  - 종이 한 장(.sheet)에 들어가도록 글자 크기를 자동으로 맞춤
 * ============================================================ */
(function (root) {
  'use strict';

  var Q = root.AgoraQuestions, S = root.AgoraScoring, A = root.AgoraAlgorithm, St = root.AgoraState, X = root.AgoraExport;
  var VK = Q.VIRTUE_KEYS;
  var COLORS = ['#1f6feb', '#e4572e', '#17a398', '#f0a202', '#8e44ad', '#2e86de', '#d35400', '#27ae60', '#c2185b', '#607d8b', '#00897b', '#6d4c41'];
  var MODE_LABEL = { auto: '교사 편성', pick: '팀별 드래프트', credit: '크레딧 드래프트' };
  var KIND_LABEL = { roster: '팀 명단 (게시용)', teams: '팀별 한 장씩', teacher: '교사용 (개인 점수 포함)', all: '저장된 모든 학급 명단' };
  var PREF_KEY = 'agora.ui.print';
  var PAGE = { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } };   // A4 (mm)
  /* 인쇄물 종류별 글자 배율 범위 — 이 안에서 한 장에 꽉 차게 맞춤 */
  var SCALE = { roster: [0.5, 2.3], teams: [0.5, 2.6], teacher: [0.5, 1.2] };

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
      else if (k === 'style') el.style.cssText = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }
  function fmt(x, d) { return (typeof x === 'number' && isFinite(x)) ? x.toFixed(d === undefined ? 1 : d) : '–'; }
  var toastTimer = null;
  function toast(msg, isError) {
    var el = $('#toast'); if (!el) return;
    el.textContent = msg; el.hidden = false; el.classList.toggle('error', !!isError);
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 5000 : 2800);
  }
  function dateOf(iso) { try { return X.localTime(iso || new Date().toISOString(), true); } catch (e) { return String(iso || '').slice(0, 10); } }
  function noOf(p) { return p && p.no !== null && p.no !== undefined ? p.no : 1e9; }

  /* ---------- 설정 (브라우저별) ---------- */
  var opt = { kind: 'roster', orient: 'portrait', gender: false, mono: false, title: '', sub: '' };
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      if (p.orient === 'landscape' || p.orient === 'portrait') opt.orient = p.orient;
      opt.gender = !!p.gender; opt.mono = !!p.mono;
    } catch (e) { /* ignore */ }
  }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify({ orient: opt.orient, gender: opt.gender, mono: opt.mono })); } catch (e) { /* ignore */ } }

  /* ---------- 인쇄할 자료 ---------- */
  /* 세션 하나의 편성 결과를 인쇄용으로 정리. 결과가 없으면 null */
  function model(session) {
    if (!session || !session.result || !Array.isArray(session.result.teams)) return null;
    var prep = S.prepareStudents(St.activeStudents(session), session.options);
    var byId = {}; prep.forEach(function (p) { byId[p.id] = p; });
    var seen = {};
    var split = session.result.split || null;
    var caps = session.result.captains || [];
    var names = session.teamNames || [];
    var isCap = function (t, id) { return caps[t] !== null && caps[t] !== undefined && caps[t] === id; };
    /* 참여 학생만, 중복 제거, 주장 먼저·나머지는 번호순 (체력 순서가 드러나지 않게) */
    var teams = session.result.teams.map(function (ids, t) {
      return (ids || []).filter(function (id) { if (!byId[id] || seen[id]) return false; seen[id] = true; return true; })
        .sort(function (a, b) { return (isCap(t, b) - isCap(t, a)) || (noOf(byId[a]) - noOf(byId[b])); });
    });
    if (!teams.some(function (t) { return t.length; })) return null;
    var ev = A.evaluateGroups(prep, teams, split);
    return {
      session: session, prep: prep, byId: byId, teams: teams, split: split, ev: ev, isCap: isCap,
      teamName: function (t) { return names[t] || A.teamLabel(t, split); },
      inactive: St.inactiveStudents(session),
      unassigned: prep.filter(function (p) { return !seen[p.id]; }),
      classText: session.classLabel ? session.classLabel + ' 학급' : '',
      date: dateOf(session.result.builtAt)
    };
  }
  function label(p) { return (p.no !== null && p.no !== undefined ? p.no + ' ' : '') + (p.name || '(이름 없음)'); }

  /* 한 줄에 놓을 팀 카드 수 */
  function colsFor(k, orient) {
    if (orient === 'landscape') return k <= 4 ? Math.max(1, k) : k <= 8 ? 4 : k <= 10 ? 5 : 6;
    return k <= 1 ? 1 : k <= 4 ? 2 : k <= 9 ? 3 : 4;
  }
  function hasCaptain(m) { return m.teams.some(function (ids, t) { return ids.some(function (id) { return m.isCap(t, id); }); }); }
  function footNotes(m) {
    var out = [];
    if (hasCaptain(m)) out.push(h('div', { class: 'sh-note' }, h('b', { text: '👑 ' }), '팀 주장'));
    if (m.inactive.length) out.push(h('div', { class: 'sh-note' }, h('b', { text: '오늘 불참 · 역할  ' }),
      m.inactive.map(function (s) { return label(s) + ' (' + (St.STATUS_LABEL[s.status] || s.status) + ')'; }).join(' · ')));
    if (m.unassigned.length) out.push(h('div', { class: 'sh-note' }, h('b', { text: '미배정  ' }), m.unassigned.map(label).join(' · ')));
    return out;
  }
  function sheetEl(cls, kind) { return h('section', { class: 'sheet ' + cls + (opt.mono ? ' mono' : ''), 'data-kind': kind }); }
  function brand() { return h('div', { class: 'sh-brand', text: 'PAPS + 인성 AI 팀빌딩 · 프로젝트 아고라' }); }

  /* ---------- ① 팀 명단 (게시용 — 개인 점수 없음) ---------- */
  function memberRow(m, t, id) {
    var p = m.byId[id], cap = m.isCap(t, id);
    return h('li', { class: cap ? 'cap' : '' },
      h('span', { class: 'no', text: p.no === null || p.no === undefined ? '' : p.no }),
      h('span', { class: 'nm', text: p.name || '(이름 없음)' }),
      cap ? h('span', { class: 'crown', text: '👑', title: '팀 주장' }) : null,
      opt.gender && p.gender ? h('span', { class: 'g ' + (p.gender === '남' ? 'm' : 'f'), text: p.gender }) : null);
  }
  function teamCard(m, t) {
    var ids = m.teams[t];
    return h('article', { class: 'pt', style: '--team:' + COLORS[t % COLORS.length] },
      h('header', null, h('b', { text: m.teamName(t) }), h('span', { text: ids.length + '명' })),
      h('ol', null, ids.map(function (id) { return memberRow(m, t, id); })));
  }
  function rosterSheet(m, title, sub) {
    var sheet = sheetEl('roster-sheet', 'roster');
    var n = m.teams.reduce(function (a, t) { return a + t.length; }, 0);
    var meta = [m.split ? '남자 팀 ' + m.split['남'] + '개 · 여자 팀 ' + m.split['여'] + '개' : m.teams.length + '팀', n + '명', '편성일 ' + m.date];
    sheet.appendChild(h('header', { class: 'sh-head' },
      h('h1', { text: title || ((m.classText ? m.classText + ' ' : '') + '팀 명단') }),
      h('div', { class: 'sh-meta', text: meta.join('  ·  ') }),
      sub ? h('div', { class: 'sh-sub', text: sub }) : null));
    var body = h('div', { class: 'sh-body' });
    m.ev.groups.forEach(function (g) {
      if (m.split) body.appendChild(h('h2', { class: 'pt-group' }, g.gender === '남' ? '남자 팀' : '여자 팀', h('small', { text: g.idx.length + '팀 · ' + g.size + '명' })));
      body.appendChild(h('div', { class: 'pt-grid', style: '--cols:' + colsFor(g.idx.length, opt.orient) }, g.idx.map(function (t) { return teamCard(m, t); })));
    });
    sheet.appendChild(body);
    sheet.appendChild(h('div', { class: 'sh-foot' }, footNotes(m), brand()));
    return sheet;
  }

  /* ---------- ② 팀별 한 장씩 (팀에 나눠 주는 용도 — 역할·메모 칸) ---------- */
  function teamSheets(m, sub) {
    return m.teams.map(function (ids, t) {
      if (!ids.length) return null;
      var sheet = sheetEl('team-sheet', 'teams');
      sheet.style.setProperty('--team', COLORS[t % COLORS.length]);
      sheet.appendChild(h('header', { class: 'ts-band' },
        h('div', { class: 'ts-top' }, h('span', { text: m.classText }), h('span', { text: ids.length + '명' })),
        h('h1', { text: m.teamName(t) })));
      sheet.appendChild(h('div', { class: 'sh-meta', text: sub || ('편성일 ' + m.date) }));
      var tb = h('tbody');
      ids.forEach(function (id) {
        var p = m.byId[id], cap = m.isCap(t, id);
        tb.appendChild(h('tr', { class: cap ? 'cap' : '' },
          h('td', { class: 'no', text: p.no === null || p.no === undefined ? '' : p.no }),
          h('td', { class: 'nm' }, h('span', { class: 'nm', text: p.name || '(이름 없음)' }),
            opt.gender && p.gender ? h('span', { class: 'g ' + (p.gender === '남' ? 'm' : 'f'), text: p.gender }) : null,
            cap ? h('span', { class: 'tag', text: '👑 주장' }) : null),
          h('td', { class: 'memo' })));
      });
      sheet.appendChild(h('div', { class: 'sh-body' }, h('table', { class: 'ts-table' },
        h('thead', null, h('tr', null, h('th', { class: 'no', text: '번호' }), h('th', { text: '이름' }), h('th', { text: '역할 · 메모' }))), tb)));
      sheet.appendChild(h('div', { class: 'sh-foot' }, brand()));
      return sheet;
    }).filter(Boolean);
  }

  /* ---------- ③ 교사용 (개인 점수 · 팀 균형표) ---------- */
  function teacherSheet(m) {
    var s = m.session, r = s.result, o = s.options;
    var sheet = sheetEl('teacher-sheet', 'teacher');
    var how = MODE_LABEL[r.mode] || (r.source === 'draft' ? '드래프트' : '교사 편성');
    sheet.appendChild(h('header', { class: 'sh-head' },
      h('h1', null, (m.classText ? m.classText + ' ' : '') + '팀 편성 결과 ', h('small', { text: '교사용' })),
      h('div', { class: 'sh-warn', text: '개인 점수가 들어 있습니다. 학생에게 공개하지 마세요.' }),
      h('div', { class: 'sh-meta', text: ['편성일 ' + m.date, how + (r.remix ? ' (새로운 조합)' : '') + (s.manualEdits ? ' · 수동 조정 있음' : ''), '공정성 점수 ' + m.ev.equity,
        'PAPS 허용편차 ' + Number(o.papsTolerance).toFixed(1) + '점', m.split ? '남녀 따로 편성' : '성별 균형 ' + (o.genderBalance ? '켬' : '끔')].join('  ·  ') })));
    var body = h('div', { class: 'sh-body' });
    /* 팀 균형표 (남녀 따로면 성별 그룹마다) */
    m.ev.groups.forEach(function (g) {
      var st = g.stats;
      var tb = h('tbody');
      st.teams.forEach(function (tm, j) {
        var t = g.idx[j];
        tb.appendChild(h('tr', null, h('td', { class: 'tn' }, h('i', { style: 'background:' + COLORS[t % COLORS.length] }), m.teamName(t)), h('td', { text: tm.size }), h('td', { text: tm.male }), h('td', { text: tm.female }),
          h('td', { text: fmt(tm.meanPaps, 1) }), VK.map(function (k) { return h('td', { text: fmt(tm.meanVirtues[k], 2) }); })));
      });
      tb.appendChild(h('tr', { class: 'foot' }, h('td', { class: 'tn', text: '범위 (최대 − 최소)' }), h('td'), h('td'), h('td'),
        h('td', { text: fmt(st.metrics.PAPS.range, 1) }), VK.map(function (k) { return h('td', { text: fmt(st.metrics[k].range, 2) }); })));
      body.appendChild(h('table', { class: 'tc-bal' },
        h('thead', null, h('tr', null, h('th', { text: (m.split ? g.label + ' ' : '') + '팀 균형' }), h('th', { text: '인원' }), h('th', { text: '남' }), h('th', { text: '여' }), h('th', { text: 'PAPS 평균' }), VK.map(function (k) { return h('th', { text: k }); }))), tb));
    });
    /* 팀별 개인 점수 */
    var edited = false, imputed = false;
    var grid = h('div', { class: 'pt-grid tc-grid', style: '--cols:' + (opt.orient === 'landscape' ? Math.min(3, Math.max(1, m.teams.length)) : Math.min(2, Math.max(1, m.teams.length))) });
    m.teams.forEach(function (ids, t) {
      var tb = h('tbody');
      ids.forEach(function (id) {
        var p = m.byId[id], cap = m.isCap(t, id), mark = '';
        if (p.papsDetail && p.papsDetail.overridden) { mark += '*'; edited = true; }
        if (p.papsImputed) { mark += '†'; imputed = true; }
        if (p.virtueImputed) imputed = true;
        tb.appendChild(h('tr', { class: cap ? 'cap' : '' },
          h('td', { class: 'no', text: p.no === null || p.no === undefined ? '' : p.no }),
          h('td', { class: 'nm' }, h('span', { class: 'nm', text: (p.name || '(이름 없음)') + (cap ? ' 👑' : '') })),
          h('td', { text: p.gender || '' }),
          h('td', { class: 'num', text: fmt(p.papsPoints, 0) + mark }),
          VK.map(function (k) { return h('td', { class: 'num', text: fmt(p.virtues[k], 1) + (p.virtueImputed ? '†' : '') }); })));
      });
      grid.appendChild(h('article', { class: 'pt', style: '--team:' + COLORS[t % COLORS.length] },
        h('header', null, h('b', { text: m.teamName(t) }), h('span', { text: ids.length + '명' })),
        h('table', { class: 'tc-table' },
          h('thead', null, h('tr', null, h('th', { class: 'no', text: '번호' }), h('th', { text: '이름' }), h('th', { text: '성' }), h('th', { text: 'PAPS' }), VK.map(function (k) { return h('th', { text: k }); }))), tb)));
    });
    body.appendChild(grid);
    sheet.appendChild(body);
    var notes = footNotes(m);
    if (r.note) notes.unshift(h('div', { class: 'sh-note' }, h('b', { text: '수정 메모  ' }), r.note));
    if (edited || imputed) notes.push(h('div', { class: 'sh-note' }, (edited ? '* 교사가 직접 고친 PAPS 점수   ' : '') + (imputed ? '† 자료가 없어 학급 평균으로 채운 점수' : '')));
    sheet.appendChild(h('div', { class: 'sh-foot' }, notes, brand()));
    return sheet;
  }

  /* ---------- 미리보기 그리기 ---------- */
  var skipped = [];
  function buildSheets() {
    skipped = [];
    var cur = St.get();
    if (opt.kind === 'all') {
      /* 현재 학급도 이름이 있으면 저장본을 갱신해 함께 포함 */
      if (cur.classLabel && cur.students.length) St.putSaved(cur.classLabel, cur);
      var out = [];
      St.listSaved().forEach(function (e) {
        var m = model(St.hydrate(JSON.parse(JSON.stringify(e.session || {}))));
        if (!m) { skipped.push(e.label); return; }
        if (!m.classText) m.classText = e.label + ' 학급';
        out.push(rosterSheet(m, '', opt.sub));
      });
      return out;
    }
    var m = model(cur);
    if (!m) return [];
    if (opt.kind === 'teams') return teamSheets(m, opt.sub);
    if (opt.kind === 'teacher') return [teacherSheet(m)];
    return [rosterSheet(m, opt.title, opt.sub)];
  }

  /* 종이 한 장에 들어가는가: 높이가 용지 안이고, 이름·팀 이름이 잘리지 않음 */
  function fits(sheet, pageH) {
    if (sheet.offsetHeight > pageH) return false;
    var i, els;
    /* 표·카드가 가로로 넘치면 맞지 않음 */
    els = sheet.querySelectorAll('.sh-body, .pt');
    for (i = 0; i < els.length; i++) if (els[i].scrollWidth > els[i].clientWidth + 1) return false;
    /* 학생 이름이 조금이라도 잘리면(말줄임) 맞지 않음. 긴 팀 이름은 그 제목만 따로 줄임(shrinkTitles) */
    els = sheet.querySelectorAll('li > .nm');
    for (i = 0; i < els.length; i++) if (els[i].scrollWidth > els[i].clientWidth) return false;
    return true;
  }
  /* 칸보다 긴 팀 이름은 그 제목 글자만 줄임 — 팀 이름 하나 때문에 종이 전체 글자가 작아지지 않게 */
  function shrinkTitles(sheet) {
    $$('.pt > header b, .ts-band h1', sheet).forEach(function (el) {
      el.style.removeProperty('--tn');
      for (var k = 0.9; el.scrollWidth > el.clientWidth && k >= 0.4; k -= 0.1) el.style.setProperty('--tn', k.toFixed(1));
    });
  }
  function pageHeightOf(sheet) { var pg = PAGE[opt.orient]; return Math.floor(sheet.offsetWidth * (pg.h - 3) / pg.w); }   // 용지 높이에서 3mm 여유
  /* 남는 세로 공간만큼 줄 간격(--rp)을 벌림. 팀별 한 장은 손으로 적을 칸이라 더 넉넉히 */
  function fitRows(sheet, pageH) {
    var kind = sheet.getAttribute('data-kind');
    var lo = 0, hi = kind === 'teacher' ? 0.2 : kind === 'teams' ? 1.4 : 0.45;
    var setRp = function (v) { sheet.style.setProperty('--rp', v.toFixed(3) + 'em'); };
    setRp(hi);
    if (fits(sheet, pageH)) return;
    for (var i = 0; i < 6; i++) { var mid = (lo + hi) / 2; setRp(mid); if (fits(sheet, pageH)) lo = mid; else hi = mid; }
    setRp(lo);
  }
  /*
   * 지금 배치에서 한 장에 들어가는 가장 큰 글자 배율(--ps)을 이분 탐색. 가장 작게 해도 넘치면 0.
   * 배율은 0.05 단위로만 시도한다 — 브라우저는 처음 쓰는 글자 크기마다 글꼴을 새로 준비하느라 느리므로(크기당 수십 ms),
   * 같은 크기를 되풀이해 쓰면 배치를 바꿔 가며 재도 빠르다. 남는 세로 공간은 줄 간격(--rp)으로 채운다.
   */
  var STEP = 0.05;
  function bestScale(sheet, pageH, range) {
    var n = Math.round((range[1] - range[0]) / STEP);
    var val = function (k) { return range[0] + k * STEP; };
    var set = function (k) { sheet.style.setProperty('--ps', val(k).toFixed(2)); };
    set(n); if (fits(sheet, pageH)) return val(n);
    set(0); if (!fits(sheet, pageH)) return 0;
    var lo = 0, hi = n;                               // lo 는 들어가고 hi 는 넘침
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; set(mid); if (fits(sheet, pageH)) lo = mid; else hi = mid; }
    return val(lo);
  }
  /*
   * 종이 한 장에 꽉 차게: ① 팀 카드를 한 줄에 몇 개 놓을지(기본 배치와 그 앞뒤, 한 줄 배치)를 바꿔 가며 글자가 가장 커지는 배치를 고르고,
   * ② 그 배율에서 세로로 남는 공간은 줄 간격(--rp)을 벌려 채운다.
   */
  function fitSheet(sheet) {
    var kind = sheet.getAttribute('data-kind'), range = SCALE[kind] || [0.5, 1.5];
    if (!sheet.offsetWidth) return;                   // 화면에 보이지 않으면 잴 수 없음
    var pageH = pageHeightOf(sheet);
    var grids = $$('.pt-grid', sheet);
    var maxCols = grids.reduce(function (a, g) { return Math.max(a, g.children.length); }, 0);
    var setCols = function (c) { grids.forEach(function (g) { g.style.setProperty('--cols', Math.max(1, Math.min(c, g.children.length))); }); };
    sheet.style.minHeight = '0';                      // 재는 동안은 내용 높이만큼만
    sheet.style.setProperty('--rp', '0em');
    var best = { ps: -1, cols: 0 };
    if (grids.length) {
      var cap = Math.min(kind === 'teacher' ? 4 : 6, maxCols), c0 = Math.min(cap, colsFor(maxCols, opt.orient)), tried = {};
      [c0, c0 - 1, c0 + 1, cap].forEach(function (c) {
        if (c < 1 || c > cap || tried[c]) return;
        tried[c] = true;
        setCols(c);
        var ps = bestScale(sheet, pageH, range);
        if (ps > best.ps + 0.01) best = { ps: ps, cols: c };
      });
      setCols(best.cols);
    } else best.ps = bestScale(sheet, pageH, range);
    if (best.ps <= 0) {                               // 가장 작게 해도 넘침 → 다음 쪽으로 이어짐
      sheet.style.setProperty('--ps', range[0].toFixed(2));
      if (grids.length) setCols(colsFor(maxCols, opt.orient));
      sheet.classList.add('overflow');
    } else {
      sheet.style.setProperty('--ps', best.ps.toFixed(2));
      fitRows(sheet, pageH);
    }
    shrinkTitles(sheet);
    sheet.style.minHeight = '';
    return best.ps;
  }
  /* 모든 종이를 맞춤. 팀별 한 장씩은 팀마다 글자 크기가 달라 보이지 않게 가장 작은 배율로 통일하고 줄 간격만 종이마다 채움 */
  function fitAll(sheets) {
    var scales = sheets.map(fitSheet);
    if (opt.kind !== 'teams' || sheets.length < 2) return;
    var ok = scales.filter(function (v) { return v > 0; });
    if (!ok.length) return;
    var common = Math.min.apply(null, ok);
    sheets.forEach(function (sheet, i) {
      if (!(scales[i] > common + 0.001)) return;
      sheet.style.minHeight = '0';
      sheet.style.setProperty('--ps', common.toFixed(2));
      sheet.style.setProperty('--rp', '0em');
      fitRows(sheet, pageHeightOf(sheet));
      shrinkTitles(sheet);
      sheet.style.minHeight = '';
    });
  }
  function pageStyle() {
    var st = $('#pv-page-style');
    if (!st) { st = h('style', { id: 'pv-page-style' }); document.head.appendChild(st); }
    /* 여백 0 + 종이 안쪽 여백(.sheet padding) → 브라우저의 머리글·바닥글(날짜·주소)이 찍히지 않음 */
    st.textContent = '@page { size: A4 ' + opt.orient + '; margin: 0; }';
  }
  function fitZoom() {
    var pages = $('#pv-pages'), scroll = $('#print-view .pv-scroll');
    if (!pages || !scroll) return;
    pages.style.zoom = '';
    var first = pages.querySelector('.sheet');
    if (!first) return;
    var avail = scroll.clientWidth - 24, w = first.offsetWidth;
    if (w && avail > 0 && w > avail) pages.style.zoom = String(Math.max(0.25, avail / w));
  }
  function render() {
    var view = $('#print-view'), pages = clear($('#pv-pages'));
    var pg = PAGE[opt.orient];
    pages.style.zoom = '';
    pages.style.setProperty('--page-w', pg.w + 'mm');
    pages.style.setProperty('--page-h', pg.h + 'mm');
    pageStyle();
    var sheets = buildSheets();
    sheets.forEach(function (sh) { pages.appendChild(sh); });
    fitAll(sheets);
    fitZoom();
    var info = $('#pv-info');
    if (!sheets.length) {
      pages.appendChild(h('div', { class: 'pv-empty', text: opt.kind === 'all' ? '편성 결과가 저장된 학급이 없습니다. 학급마다 편성을 마친 뒤 다시 열어 주세요.' : '아직 편성 결과가 없습니다. 3단계에서 편성을 마친 뒤 인쇄하세요.' }));
      info.textContent = '';
    } else {
      var over = sheets.filter(function (sh) { return sh.classList.contains('overflow'); }).length;
      info.textContent = sheets.length + '장' + (opt.kind === 'all' && skipped.length ? ' · 편성 결과가 없어 뺀 학급: ' + skipped.join(', ') : '') + (over ? ' · 내용이 많아 ' + over + '장은 다음 쪽으로 넘어갑니다 (용지 방향을 바꿔 보세요)' : '');
    }
    $('#pv-print').disabled = !sheets.length;
    /* 제목은 현재 학급 명단에만, 한 줄 메모는 명단류에만 */
    $('#pv-title-wrap').hidden = opt.kind !== 'roster';
    $('#pv-sub-wrap').hidden = opt.kind === 'teacher';
    view.classList.toggle('landscape', opt.orient === 'landscape');
  }

  /* ---------- 열기 · 닫기 · 인쇄 ---------- */
  var prevTitle = null;
  function isOpen() { var v = $('#print-view'); return !!v && !v.hidden; }
  function open(kind) {
    var cur = St.get();
    if (kind !== 'all' && !model(cur)) { toast('먼저 3단계에서 팀 편성을 마치세요.', true); return; }
    opt.kind = KIND_LABEL[kind] ? kind : 'roster';
    opt.title = ''; opt.sub = '';
    $('#pv-kind').value = opt.kind; $('#pv-orient').value = opt.orient;
    $('#pv-gender').checked = opt.gender; $('#pv-mono').checked = opt.mono;
    $('#pv-title').value = ''; $('#pv-sub').value = '';
    $('#pv-title').placeholder = (cur.classLabel ? cur.classLabel + ' 학급 ' : '') + '팀 명단';
    $('#print-view').hidden = false;
    document.body.classList.add('pv-open');
    render();
    $('#pv-print').focus();
  }
  function close() {
    $('#print-view').hidden = true;
    document.body.classList.remove('pv-open');
    clear($('#pv-pages'));
  }
  function doPrint() {
    if (!$$('#pv-pages .sheet').length) return;
    /* 인쇄 창의 문서 이름(PDF 저장 파일 이름)을 학급·인쇄물 이름으로 */
    var cur = St.get();
    prevTitle = document.title;
    document.title = (opt.kind === 'all' ? '모든 학급' : (cur.classLabel || '팀편성')) + ' ' + ({ roster: '팀 명단', teams: '팀별 명단', teacher: '팀 편성 결과(교사용)', all: '팀 명단' }[opt.kind]);
    root.print();
  }
  function restoreTitle() { if (prevTitle !== null) { document.title = prevTitle; prevTitle = null; } }

  function bind() {
    var on = function (id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); };
    on('#btn-print', 'click', function () { open('roster'); });
    on('#btn-print-roster', 'click', function () { open('roster'); });
    on('#btn-print-teams', 'click', function () { open('teams'); });
    on('#btn-print-teacher', 'click', function () { open('teacher'); });
    on('#btn-print-all', 'click', function () { open('all'); });
    on('#pv-kind', 'change', function (e) { opt.kind = e.target.value; render(); });
    on('#pv-orient', 'change', function (e) { opt.orient = e.target.value === 'landscape' ? 'landscape' : 'portrait'; savePrefs(); render(); });
    on('#pv-gender', 'change', function (e) { opt.gender = e.target.checked; savePrefs(); render(); });
    on('#pv-mono', 'change', function (e) { opt.mono = e.target.checked; savePrefs(); render(); });
    /* 글자를 치는 동안은 잠깐 기다렸다가 다시 그림 */
    var typing = null, later = function () { clearTimeout(typing); typing = setTimeout(render, 250); };
    on('#pv-title', 'input', function (e) { opt.title = e.target.value.trim(); later(); });
    on('#pv-sub', 'input', function (e) { opt.sub = e.target.value.trim(); later(); });
    on('#pv-print', 'click', doPrint);
    on('#pv-close', 'click', close);
    root.addEventListener('afterprint', restoreTitle);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) close(); });
    var rt = null;
    root.addEventListener('resize', function () { if (!isOpen()) return; clearTimeout(rt); rt = setTimeout(fitZoom, 150); });
  }
  function init() {
    if (!$('#print-view')) return;
    loadPrefs(); bind();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  root.AgoraPrint = { open: open, close: close, model: model, colsFor: colsFor };
})(window);
