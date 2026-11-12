/* ============================================================
 * ui.js — 화면 렌더링과 이벤트
 * ============================================================ */
(function (root) {
  'use strict';

  var Q = root.AgoraQuestions, S = root.AgoraScoring, A = root.AgoraAlgorithm,
      P = root.AgoraParse, St = root.AgoraState, X = root.AgoraExport, T = root.AgoraPapsTable;
  var VK = Q.VIRTUE_KEYS;
  var TEAM_COLORS = ['#1f6feb', '#e4572e', '#17a398', '#f0a202', '#8e44ad', '#2e86de', '#d35400', '#27ae60', '#c2185b', '#607d8b', '#00897b', '#6d4c41'];

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
  function svg(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }
  function fmt(x, d) { return (typeof x === 'number' && isFinite(x)) ? x.toFixed(d === undefined ? 2 : d) : '–'; }
  function fz(x) { return (typeof x === 'number' && isFinite(x)) ? (x >= 0 ? '+' : '') + x.toFixed(2) : '–'; }
  var toastTimer = null;
  function toast(msg, isError) {
    var el = $('#toast');
    el.textContent = msg; el.hidden = false; el.classList.toggle('error', !!isError);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 5000 : 2800);
  }
  function teamColor(t) { return TEAM_COLORS[t % TEAM_COLORS.length]; }
  /* 남녀 따로 설정: {남: Km, 여: Kf} 또는 null (결과가 있으면 결과 기준, 없으면 설정 기준) */
  function splitOf(s) {
    if (s.result && s.result.split) return s.result.split;
    if (s.result) return null;
    return s.options.genderSeparate ? { 남: Math.max(1, s.options.teamCountM | 0), 여: Math.max(1, s.options.teamCountF | 0) } : null;
  }
  function totalTeamCount(s) { var sp = splitOf(s); return sp ? sp['남'] + sp['여'] : Math.max(1, s.options.teamCount | 0); }
  function teamName(t) { var s = St.get(); return (s.teamNames && s.teamNames[t]) || A.teamLabel(t, splitOf(s)); }
  function label(s) { return (s.no !== null && s.no !== undefined ? s.no + ' ' : '') + (s.name || '(이름 없음)'); }
  function keyOf(r) {
    if (r.no !== null && r.no !== undefined && r.no !== '') return 'n' + r.no;
    if (r.name) return 'm' + String(r.name).replace(/\s/g, '').toLowerCase();
    return null;
  }

  /* ---------- 파생 데이터 ---------- */
  /* 편성 대상 = 참여 학생만 (결석·활동 제한·기록/심판 제외). 결측 대체(학급 평균)도 참여 학생 기준 */
  function prepare(session) { return S.prepareStudents(St.activeStudents(session), session.options); }
  /* 결과 팀에서 명단에 없는 학생·불참 학생·중복을 걷어냄. 불참 학생은 result.teams 에는 남아 있어 복귀하면 원래 팀으로 돌아감 */
  function sanitizeTeamsReport(session) {
    if (!session.result || !Array.isArray(session.result.teams)) return { teams: null, dups: 0 };
    var ids = {}; St.activeStudents(session).forEach(function (s) { ids[s.id] = true; });
    var seen = {}, dups = 0;
    var teams = session.result.teams.map(function (t) {
      return t.filter(function (id) { if (!ids[id]) return false; if (seen[id]) { dups++; return false; } seen[id] = true; return true; });
    });
    return { teams: teams, dups: dups };
  }
  function sanitizeTeams(session) { return sanitizeTeamsReport(session).teams; }
  function unassignedIds(session, teams) {
    var inTeam = {};
    (teams || []).forEach(function (t) { t.forEach(function (id) { inTeam[id] = true; }); });
    return St.activeStudents(session).filter(function (s) { return !inTeam[s.id]; }).map(function (s) { return s.id; });
  }
  function normName(s) { return String(s || '').replace(/\s/g, '').toLowerCase(); }
  function classLabelOf(ci) { return ci.grade !== null && ci.grade !== undefined ? ci.grade + '-' + ci.cls : ci.cls + '반'; }
  function sameClass(a, b) {
    if (!a || !b || a.cls === null || a.cls === undefined || b.cls === null || b.cls === undefined) return false;
    if (a.cls !== b.cls) return false;
    return a.grade === null || a.grade === undefined || b.grade === null || b.grade === undefined || a.grade === b.grade;
  }
  function currentClassInfo(s) { return s.classInfo || (s.classLabel ? P.parseClass(s.classLabel) : null); }

  /* ============================================================
   * 1. 데이터 불러오기
   * ============================================================ */
  var pending = { paps: null, survey: null };   // {fileName, sheets:[{name,rows}], sheetIndex, det}

  function loadRowsFromFile(kind, file) {
    var name = file.name || '파일';
    var ext = (name.split('.').pop() || '').toLowerCase();
    var reader = new FileReader();
    reader.onerror = function () { toast('파일을 읽지 못했습니다.', true); };
    if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
      reader.onload = function () {
        var text = reader.result;
        try { setPending(kind, name, [{ name: 'CSV', rows: P.parseDelimitedText(text) }]); }
        catch (e) { toast('표를 읽지 못했습니다: ' + e.message, true); }
      };
      reader.readAsText(file, 'utf-8');
    } else {
      reader.onload = function () {
        try { setPending(kind, name, P.readWorkbook(new Uint8Array(reader.result))); }
        catch (e) { toast('엑셀 파일을 읽지 못했습니다: ' + e.message, true); }
      };
      reader.readAsArrayBuffer(file);
    }
  }

  var lastImport = { paps: null, survey: null };  // 자동 반영한 파일의 매핑 (수정용)

  /* 열 인식이 확실한가: 학생 식별 열 + 점수 열이 있고 경고가 없음 */
  function isConfident(det) {
    var m = det.mapping;
    var hasId = m.no !== undefined || m.hakbun !== undefined || m.name !== undefined;
    var hasData = (det.meta && det.meta.neis) || m.run !== undefined || m.papsGiven !== undefined || m.itemCount === 32 || m['v_성실'] !== undefined;
    return hasId && hasData && det.warnings.length === 0;
  }

  function setPending(kind, fileName, sheets) {
    sheets = (sheets || []).filter(function (sh) { return sh.rows && sh.rows.length; });
    if (!sheets.length) { toast('읽을 수 있는 표가 없습니다.', true); return; }
    /* 가장 잘 인식되는 시트를 기본 선택 */
    var bestIdx = 0, bestScore = -1;
    sheets.forEach(function (sh, i) { var d = P.detectTable(sh.rows); if (d.score > bestScore) { bestScore = d.score; bestIdx = i; } });
    pending[kind] = { fileName: fileName, sheets: sheets, sheetIndex: bestIdx, det: P.detectTable(sheets[bestIdx].rows), allSheets: false };
    /* 확실하면 확인 없이 바로 반영 (시트가 여러 개면 읽을 범위를 먼저 확인) */
    if (sheets.length === 1 && isConfident(pending[kind].det)) {
      lastImport[kind] = pending[kind];
      var r = applyPending(kind, true);
      if (r === true) {
        var roster = $('#sec-roster');
        /* 단계별 화면이면 1단계에 머물며 '다음' 버튼을 강조, 한 페이지 보기면 명단으로 스크롤 */
        if (root.AgoraWizard && root.AgoraWizard.isOn()) { var nv = $('#sec-import .step-nav'); if (nv) nv.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        else if (roster) roster.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (r === 'panel') return;   // 학급 선택 패널이 떠 있음
      pending[kind] = lastImport[kind]; lastImport[kind] = null;
    }
    renderMapping(kind);
  }

  function renderMapping(kind) {
    var box = $('#map-' + kind);
    clear(box);
    var pd = pending[kind];
    if (!pd) return;
    var sheet = pd.sheets[pd.sheetIndex], rows = sheet.rows, det = pd.det, m = det.mapping;
    var headers = det.headers;
    var wrap = h('div', { class: 'map-box' });
    wrap.appendChild(h('div', { class: 'row wrap' },
      h('b', { text: pd.fileName }),
      pd.sheets.length > 1 ? h('label', { class: 'inline' }, '시트(학급) ',
        h('select', { onchange: function (e) { pd.sheetIndex = +e.target.value; pd.det = P.detectTable(pd.sheets[pd.sheetIndex].rows); renderMapping(kind); } },
          pd.sheets.map(function (sh, i) { return h('option', { value: i, selected: i === pd.sheetIndex, text: sh.name + ' (' + sh.rows.length + '행)' }); }))) : h('span', { class: 'hint', text: rows.length + '행' })
    ));
    det.warnings.forEach(function (w) { wrap.appendChild(h('div', { class: 'warn', text: w })); });
    if (pd.sheets.length > 1) wrap.appendChild(h('div', { class: 'warn', text: '시트가 ' + pd.sheets.length + '개입니다. "이 자료 반영"은 위에서 고른 시트 하나만 읽습니다. 시트마다 반이 다르면 "모든 시트 합쳐 반영"을 누르세요 — 반별로 나눠 학급 목록이 뜹니다(시트 이름이 "3"·"1-3"처럼 반이면 반으로 인식).' }));
    /* 인식 요약 + 적용 버튼을 먼저, 세부 매핑은 접어 둠 */
    var found = [];
    if (m.no !== undefined) found.push('번호'); if (m.hakbun !== undefined) found.push('학번'); if (m.name !== undefined) found.push('이름'); if (m.gender !== undefined) found.push('성별');
    if (det.meta && det.meta.neis) found.push('나이스 영역 점수'); else if (m.run !== undefined || m.flex1 !== undefined) found.push('PAPS 원기록');
    if (m.papsGiven !== undefined) found.push('PAPS 총점');
    if (m.itemCount) found.push('인성 ' + m.itemCount + '문항'); if (m['v_성실'] !== undefined) found.push('4덕목');
    var recCount = P.extractStudents(rows, det).length;
    wrap.appendChild(h('div', { class: 'row wrap', style: 'margin:.5rem 0' },
      h('span', { class: 'hint', text: '인식된 열: ' + (found.join(' · ') || '없음') + ' · 학생 ' + recCount + '명' }),
      h('button', { class: 'btn primary', type: 'button', onclick: function () { pd.allSheets = false; applyPending(kind); } }, '이 자료 반영'),
      pd.sheets.length > 1 ? h('button', { class: 'btn', type: 'button', title: '모든 시트의 학생을 읽어 반별로 나눕니다', onclick: function () { pd.allSheets = true; applyPending(kind); } }, '모든 시트 합쳐 반영') : null,
      h('button', { class: 'btn ghost', type: 'button', onclick: function () { detail.hidden = !detail.hidden; this.textContent = detail.hidden ? '열 매핑 보기' : '열 매핑 닫기'; } }, '열 매핑 보기'),
      h('button', { class: 'btn ghost', type: 'button', onclick: function () { pending[kind] = null; clear(box); } }, '취소')
    ));
    var detail = h('div', { hidden: true });
    wrap.appendChild(detail);
    var wrapOuter = wrap; wrap = detail;

    /* 필드 매핑 표 */
    var colOptions = function (selected) {
      var opts = [h('option', { value: -1, text: '— 없음 —' })];
      headers.forEach(function (hd, c) { opts.push(h('option', { value: c, selected: selected === c, text: colLetter(c) + ': ' + (hd || '(빈 헤더)') })); });
      return opts;
    };
    var table = h('table');
    var groups = {};
    P.FIELD_DEFS.forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
    var relevant = kind === 'paps' ? ['기본', 'PAPS 원기록', 'PAPS 계산값', '인성 4덕목'] : ['기본', '인성 4덕목', 'PAPS 원기록', 'PAPS 계산값'];
    relevant.forEach(function (g) {
      var detailsOpen = (kind === 'paps') ? (g !== '인성 4덕목') : (g === '기본' || g === '인성 4덕목');
      table.appendChild(h('tr', { class: 'group' }, h('td', { colspan: 2, text: g + (detailsOpen ? '' : ' (필요하면 지정)') })));
      groups[g].forEach(function (f) {
        var sel = h('select', { onchange: function (e) { var v = +e.target.value; if (v < 0) delete m[f.key]; else m[f.key] = v; } }, colOptions(m[f.key] === undefined ? -1 : m[f.key]));
        table.appendChild(h('tr', null, h('td', { text: f.label }), h('td', null, sel)));
      });
    });
    /* 32문항 */
    table.appendChild(h('tr', { class: 'group' }, h('td', { colspan: 2, text: '인성 32문항' })));
    var itemInfo = h('span', { class: 'hint' });
    function refreshItemInfo() { itemInfo.textContent = m.itemCount + '개 문항 열 인식'; }
    refreshItemInfo();
    var startSel = h('select', { onchange: function (e) {
      var start = +e.target.value;
      if (start < 0) { m.items = new Array(32).fill(-1); m.itemCount = 0; }
      else { m.items = Array.from({ length: 32 }, function (_, i) { return start + i < headers.length ? start + i : -1; }); m.itemCount = m.items.filter(function (c) { return c >= 0; }).length; }
      refreshItemInfo();
    } }, [h('option', { value: -1, text: '— 자동 인식 사용 —' })].concat(headers.map(function (hd, c) { return h('option', { value: c, text: colLetter(c) + ': ' + (hd || '(빈 헤더)') + ' 부터 32열' }); })));
    table.appendChild(h('tr', null, h('td', null, '문항 1 시작 열 ', itemInfo), h('td', null, startSel)));
    wrap.appendChild(table);

    /* 미리보기 */
    var prev = h('div', { class: 'preview' });
    var pt = h('table');
    pt.appendChild(h('tr', null, headers.slice(0, 40).map(function (hd, c) { return h('th', { text: colLetter(c) + ' ' + (hd || '') }); })));
    rows.slice(det.headerRow + 1, det.headerRow + 5).forEach(function (r) {
      pt.appendChild(h('tr', null, headers.slice(0, 40).map(function (_, c) { return h('td', { text: r && r[c] !== null && r[c] !== undefined ? String(r[c]) : '' }); })));
    });
    prev.appendChild(pt);
    wrap.appendChild(prev);
    box.appendChild(wrapOuter);
  }
  function colLetter(c) { var s = ''; c = c + 1; while (c > 0) { var r = (c - 1) % 26; s = String.fromCharCode(65 + r) + s; c = Math.floor((c - 1) / 26); } return s; }

  /* pending 의 시트(들)에서 학생 레코드 수집 + 검증 보고 */
  function collectRecords(pd) {
    var idxs = pd.allSheets ? pd.sheets.map(function (_, i) { return i; }) : [pd.sheetIndex];
    var recs = [], skipped = [], dups = [], noData = 0, partial = 0, rows = 0, names = [];
    idxs.forEach(function (i) {
      var sh = pd.sheets[i];
      var det = i === pd.sheetIndex ? pd.det : P.detectTable(sh.rows);
      if (det.mapping.no === undefined && det.mapping.name === undefined && det.mapping.hakbun === undefined) return;
      det.meta = det.meta || {};
      det.meta.sheetClass = (pd.allSheets && pd.sheets.length > 1) ? P.parseClass(sh.name) : null;
      var rep = P.extractReport(sh.rows, det);
      var tag = pd.allSheets && pd.sheets.length > 1 ? '[' + sh.name + '] ' : '';
      recs = recs.concat(rep.records);
      rep.skipped.forEach(function (x) { skipped.push({ row: x.row, reason: x.reason, text: x.text, sheet: tag }); });
      dups = dups.concat(rep.duplicates);
      noData += rep.noData; partial += rep.partial; rows += Math.max(0, sh.rows.length - det.headerRow - 1); names.push(sh.name);
    });
    return { recs: recs, skipped: skipped, duplicates: dups, noData: noData, partial: partial, rows: rows, sheetName: names.join(', ') };
  }
  /* 레코드를 반별로 묶기 (반을 모르는 레코드는 key null 그룹) */
  function groupByClass(recs) {
    var map = {}, order = [];
    recs.forEach(function (r) {
      var k = P.classKeyOf(r) || '';
      if (!map[k]) { map[k] = { key: k || null, grade: r.grade, cls: r.cls, recs: [], label: k ? classLabelOf(r) : '반 미상', uniq: 0, seen: {} }; order.push(k); }
      map[k].recs.push(r);
      var sk = keyOf(r) || ('r' + map[k].recs.length);
      if (!map[k].seen[sk]) { map[k].seen[sk] = true; map[k].uniq++; }
    });
    return order.map(function (k) { return map[k]; }).sort(function (a, b) {
      if (!a.key) return 1; if (!b.key) return -1;
      return (a.grade || 0) - (b.grade || 0) || (a.cls || 0) - (b.cls || 0);
    });
  }
  function nameOverlap(students, recs) {
    var set = {}; students.forEach(function (s) { if (s.name) set[normName(s.name)] = true; });
    var n = 0; recs.forEach(function (r) { if (r.name && set[normName(r.name)]) n++; });
    return n;
  }

  /*
   * quiet: 자동 반영 시 실패해도 토스트 대신 false 반환.
   * 반환 true(반영) / false(열 지정 필요) / 'panel'(학급 선택 패널 표시)
   */
  function applyPending(kind, quiet) {
    var pd = pending[kind];
    if (!pd) return false;
    var det = pd.det;
    det.mapping.itemCount = det.mapping.items.filter(function (c) { return c >= 0; }).length;
    if (det.mapping.no === undefined && det.mapping.name === undefined && det.mapping.hakbun === undefined) { if (!quiet) toast('번호, 학번 또는 이름 열을 지정해 주세요.', true); return false; }
    var col = collectRecords(pd);
    var recs = col.recs;
    if (!recs.length) { if (!quiet) toast('학생 행을 찾지 못했습니다. 헤더 행과 번호/이름 열을 확인하세요.', true); return false; }
    var hasData = recs.some(function (r) { return r.papsRaw || r.papsGiven !== null || r.items || r.virtuesGiven; });
    if (!hasData) { if (!quiet) toast('점수 열(PAPS 원기록/총점 또는 32문항/4덕목)을 지정해 주세요.', true); return false; }

    /* 학급 구분: 파일에 반 정보가 있으면 현재 학급과 맞는 반만 반영 (다른 반 혼입 방지) */
    var groups = groupByClass(recs);
    var known = groups.filter(function (g) { return g.key; });
    var s = St.get();
    var cur = currentClassInfo(s);
    var choice = null;
    if (known.length) {
      if (cur) choice = known.find(function (g) { return sameClass(g, cur); }) || null;
      if (!choice && !cur && known.length === 1) choice = known[0];
      if (!choice && !cur && known.length >= 2 && s.students.length) {
        /* 현재 명단과 이름이 가장 많이 겹치는 반을 자동 선택 */
        var best = null, bestN = 0;
        known.forEach(function (g) { var n = nameOverlap(s.students, g.recs); if (n > bestN) { bestN = n; best = g; } });
        if (best && bestN >= Math.max(3, Math.ceil(0.6 * Math.min(s.students.length, best.recs.length)))) choice = best;
      }
      if (!choice) { renderClassPanel(kind, pd, col, groups, cur); return 'panel'; }
      recs = choice.recs.slice();
    } else if (s.students.length) {
      /* 파일에 반 정보가 없으면(나이스 조회 파일 등) 이름으로 학급을 확인: 현재 명단과 거의 안 겹치면
       * 저장된 학급 중 이름이 맞는 반으로 전환하고, 없으면 섞기 전에 물어봄 */
      var named = recs.filter(function (r) { return r.name; });
      if (named.length >= 3) {
        var curHit = nameOverlap(s.students, named);
        if (curHit < Math.ceil(named.length * 0.5)) {
          var bestSaved = null, bestHit = 0;
          St.listSaved().forEach(function (e) {
            if (e.label === s.classLabel) return;
            var hit = nameOverlap((e.session && e.session.students) || [], named);
            if (hit > bestHit) { bestHit = hit; bestSaved = e; }
          });
          if (bestSaved && bestHit >= Math.ceil(named.length * 0.6)) {
            switchClass(bestSaved.label);
            finishApply(kind, pd, recs, col, { excluded: 0, classCount: 0, chosen: null, switched: bestSaved.label });
            return true;
          }
          renderNameMismatchPanel(kind, pd, col, curHit, named.length); return 'panel';
        }
      }
    }
    finishApply(kind, pd, recs, col, { excluded: col.recs.length - recs.length, classCount: known.length, unknownCount: known.length ? (groups.length - known.length ? groups[groups.length - 1].recs.length : 0) : 0, chosen: choice });
    return true;
  }

  /* 선택된 레코드를 현재 세션에 반영하고 검증 보고를 남김 */
  function finishApply(kind, pd, recs, col, extra) {
    var det = pd.det;
    var meta = { fileName: pd.fileName, sheetName: col.sheetName, papsGivenType: det.mapping.papsGivenType, neis: det.meta && det.meta.neis };
    var inferMsg = '';
    St.update(function (ss) {
      if (extra.chosen && !ss.classInfo) { ss.classInfo = { grade: extra.chosen.grade, cls: extra.chosen.cls }; if (!ss.classLabel) ss.classLabel = extra.chosen.label; }
      var report = applyRecordsTo(ss, kind, recs, meta);
      report.skipped = col.skipped; report.duplicates = col.duplicates; report.noData = col.noData; report.partial = col.partial; report.rows = col.rows;
      report.excluded = extra.excluded || 0; report.classCount = extra.classCount || 0; report.unknownCount = extra.unknownCount || 0; report.chosen = extra.chosen ? extra.chosen.label : null;
      ss.imports[kind] = report;
      if (meta.neis) {
        var inf = inferGenderInto(ss);
        if (inf.applied) inferMsg = ' 나이스 점수로 기준표를 대조해 ' + (inf.inf.gradeKeyShare >= 0.8 ? inf.inf.gradeKey + ' 기준표, ' : '') + '성별 ' + inf.applied + '명(남 ' + inf.inf.counts['남'] + ' 여 ' + inf.inf.counts['여'] + ')을 추정했습니다. 명단에서 확인하세요.';
      }
    });
    lastImport[kind] = pd;
    pending[kind] = null;
    clear($('#map-' + kind));
    var rep = St.get().imports[kind] || {};
    var msg = (extra.switched ? '이름이 맞는 ' + extra.switched + ' 학급으로 전환했습니다. ' : '') + (rep.added + rep.updated || recs.length) + '명의 자료를 반영했습니다' + (extra.chosen ? ' (' + extra.chosen.label + ' 학급)' : '') + (extra.excluded ? ' · 다른 반 ' + extra.excluded + '명은 제외' : '') + '.';
    if (col.skipped.length) msg += ' 건너뛴 행 ' + col.skipped.length + '개는 1단계 검증 결과에서 확인하세요.';
    toast(msg + inferMsg);
  }

  /* 나이스 영역 점수와 기준표를 대조해 성별·학년(기준표) 추정 — 세션 객체를 직접 바꿈 */
  function inferGenderInto(ss) {
    var inf = S.inferFromNeis(ss.students, ss.options);
    var applied = 0;
    if (inf.inferred) {
      ss.students.forEach(function (st) {
        var r = inf.byId[st.id];
        if (r && !st.gender) { st.gender = r.gender; st.genderInferred = true; applied++; }
      });
      if (inf.gradeKey && inf.gradeKeyShare >= 0.8) {
        ss.options.schoolLevel = inf.gradeKey.charAt(0);
        ss.options.defaultGrade = parseInt(inf.gradeKey.slice(1), 10) || ss.options.defaultGrade;
      }
    }
    return { applied: applied, inf: inf };
  }

  /* 반 정보가 없는 파일인데 현재 명단과 이름이 거의 맞지 않을 때: 섞기 전에 확인 */
  function renderNameMismatchPanel(kind, pd, col, hit, total) {
    var box = clear($('#map-' + kind));
    var s = St.get();
    var wrap = h('div', { class: 'map-box class-panel' },
      h('div', { class: 'row wrap' }, h('b', { text: '⚠ 명단과 이름이 맞지 않습니다' })),
      h('p', { class: 'hint', text: '현재 화면' + (s.classLabel ? '(' + s.classLabel + ' 학급, ' : '(') + s.students.length + '명)의 이름과 이 파일(' + pd.fileName + ')의 이름이 ' + total + '명 중 ' + hit + '명만 같습니다. 다른 반 파일이거나 설문의 학번이 잘못 입력됐을 수 있어, 아직 합치지 않았습니다.' }),
      h('div', { class: 'row wrap', style: 'margin-top:.4rem' },
        h('button', { class: 'btn primary', type: 'button', title: '이름이 같은 학생은 이름으로, 나머지는 번호로 연결합니다', onclick: function () { finishApply(kind, pd, col.recs, col, { excluded: 0, classCount: 0, chosen: null }); } }, '그래도 이 학급에 합치기'),
        h('button', { class: 'btn', type: 'button', title: '현재 학급은 저장하고, 이 파일로 새 학급을 만듭니다', onclick: function () {
          var lbl = prompt('새 학급 이름을 입력하세요 (예: 1-3)', '');
          if (!lbl || !lbl.trim()) return;
          switchClass(lbl.trim());
          finishApply(kind, pd, col.recs, col, { excluded: 0, classCount: 0, chosen: null });
        } }, '새 학급으로 불러오기'),
        h('button', { class: 'btn ghost', type: 'button', onclick: function () { pending[kind] = null; clear(box); } }, '취소')));
    box.appendChild(wrap);
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* 여러 반 파일: 어느 반을 불러올지 고르는 패널 (또는 현재 학급과 다른 반 경고) */
  function renderClassPanel(kind, pd, col, groups, cur) {
    var box = clear($('#map-' + kind));
    var s = St.get();
    var known = groups.filter(function (g) { return g.key; });
    var wrap = h('div', { class: 'map-box class-panel' });
    var title, desc;
    if (known.length >= 2) {
      title = '📚 ' + pd.fileName + ' — ' + known.length + '개 반 · ' + groups.reduce(function (a, g) { return a + g.uniq; }, 0) + '명';
      desc = '여러 반이 들어 있는 자료입니다. 반이 섞이지 않도록 한 반씩 불러옵니다. 불러올 반을 고르거나, "모든 반을 각각 저장"한 뒤 상단 학급 전환에서 반을 바꿔 가며 편성하세요.';
    } else {
      title = '⚠ 학급이 다릅니다';
      desc = '현재 화면은 ' + (s.classLabel || (cur ? classLabelOf(cur) : '')) + ' 학급(' + s.students.length + '명)인데, 이 파일은 ' + known[0].label + ' 자료(' + known[0].recs.length + '명)입니다. 다른 반 자료가 섞이지 않도록 아직 반영하지 않았습니다.';
    }
    wrap.appendChild(h('div', { class: 'row wrap' }, h('b', { text: title })));
    wrap.appendChild(h('p', { class: 'hint', text: desc }));
    if (s.students.length) wrap.appendChild(h('p', { class: 'hint', text: '현재 화면: ' + (s.classLabel || '학급 이름 없음') + ' · ' + s.students.length + '명' + (cur ? '' : ' — 상단 학급 칸에 "1-3"처럼 적어 두면 다음부터 맞는 반만 자동으로 들어옵니다.') }));
    var saved = St.listSaved();
    var table = h('table', { class: 'class-table' });
    table.appendChild(h('thead', null, h('tr', null, h('th', { text: '반' }), h('th', { text: '인원' }), h('th', { text: '번호 범위' }), h('th', { text: '저장본' }), h('th'))));
    var tb = h('tbody');
    groups.forEach(function (g) {
      var nos = g.recs.map(function (r) { return r.no; }).filter(function (n) { return n !== null; });
      var range = nos.length ? Math.min.apply(null, nos) + '~' + Math.max.apply(null, nos) : '–';
      var isCur = cur && g.key && sameClass(g, cur);
      var sv = g.key ? saved.find(function (e) { return e.label === g.label; }) : null;
      var btnLabel = !g.key ? '현재 학급에 합치기' : isCur ? '현재 학급에 반영' : (s.students.length ? '이 반으로 전환해 불러오기' : '이 반 불러오기');
      tb.appendChild(h('tr', { class: isCur ? 'cur' : '' },
        h('td', null, h('b', { text: g.label }), !g.key ? h('span', { class: 'hint', text: ' (학번에 반이 없는 응답)' }) : null),
        h('td', { text: g.uniq + '명' + (g.recs.length > g.uniq ? ' (중복 ' + (g.recs.length - g.uniq) + ')' : '') }), h('td', { text: range }),
        h('td', { class: 'hint', text: sv ? '있음 · ' + ((sv.session && sv.session.students) || []).length + '명' + (sv.session && sv.session.result ? ' · 편성됨' : '') : '' }),
        h('td', null, h('button', { class: 'btn small' + (isCur ? ' primary' : ''), type: 'button', onclick: function () { importGroup(kind, pd, col, groups, g, cur); } }, btnLabel))));
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    var actions = h('div', { class: 'row wrap', style: 'margin-top:.6rem' });
    if (known.length >= 2) actions.appendChild(h('button', { class: 'btn primary', type: 'button', title: '반마다 학급 저장본을 만들거나 갱신합니다 (이미 저장된 반은 자료를 합침)', onclick: function () { saveAllClasses(kind, pd, col, groups); } }, '모든 반을 각각 저장 (' + known.length + '개 반)'));
    if (known.length === 1 && s.students.length) actions.appendChild(h('button', { class: 'btn ghost', type: 'button', onclick: function () {
      if (confirm('정말 다른 반 자료를 현재 학급에 합칠까요? 번호가 같은 학생이 덮어써질 수 있습니다.')) finishApply(kind, pd, col.recs, col, { excluded: 0, classCount: groups.length, chosen: null });
    } }, '그래도 현재 학급에 합치기'));
    actions.appendChild(h('button', { class: 'btn ghost', type: 'button', onclick: function () { pending[kind] = null; clear(box); } }, '취소'));
    wrap.appendChild(actions);
    if (col.skipped.length) wrap.appendChild(h('div', { class: 'warn', text: '건너뛴 행 ' + col.skipped.length + '개: ' + col.skipped.slice(0, 5).map(function (x) { return (x.sheet || '') + x.row + '행 ' + x.reason + (x.text ? ' "' + x.text + '"' : ''); }).join(' · ') + (col.skipped.length > 5 ? ' …' : '') }));
    box.appendChild(wrap);
  }
  function importGroup(kind, pd, col, groups, g, cur) {
    var s = St.get();
    var isCur = cur && g.key && sameClass(g, cur);
    if (g.key && !isCur && s.students.length) switchClass(g.label, { grade: g.grade, cls: g.cls });
    finishApply(kind, pd, g.recs.slice(), col, { excluded: col.recs.length - g.recs.length, classCount: groups.length, chosen: g.key ? g : null });
  }
  /* 학급 전환: 현재 화면을 학급 이름으로 저장하고, 저장본(없으면 새 세션)을 불러옴 */
  function switchClass(label, classInfo, quiet) {
    var s = St.get();
    var savedPrev = false;
    if (s.students.length) {
      var curLabel = s.classLabel || (s.classInfo ? classLabelOf(s.classInfo) : '');
      if (!curLabel) curLabel = prompt('현재 화면의 학급 이름을 정해 저장합니다 (예: 1-3). 비우면 저장하지 않습니다.', '') || '';
      if (curLabel.trim()) { St.putSaved(curLabel.trim(), s); savedPrev = true; }
    }
    var target = St.getSaved(label);
    if (!target) { target = St.newSession(); target.classLabel = label; target.classInfo = classInfo || P.parseClass(label) || null; }
    St.replace(target);
    pending = { paps: null, survey: null }; lastImport = { paps: null, survey: null };
    clear($('#map-paps')); clear($('#map-survey'));
    if (!quiet) toast(label + ' 학급으로 전환했습니다' + (savedPrev ? ' (이전 학급은 저장됨)' : '') + '.');
    return savedPrev;
  }
  /* ---------- 새 반 추가 ---------- */
  /* 다음 반 이름 제안: 현재·저장된 학급이 "1-3" 꼴이면 같은 학년의 가장 큰 반 + 1 */
  function suggestNextClass(s) {
    var cur = currentClassInfo(s);
    if (!cur || cur.cls === null || cur.cls === undefined || cur.grade === null || cur.grade === undefined) return '';
    var mx = cur.cls;
    St.listSaved().forEach(function (e) { var pc = P.parseClass(e.label); if (pc && pc.grade === cur.grade && pc.cls > mx) mx = pc.cls; });
    return cur.grade + '-' + (mx + 1);
  }
  /* 학생과 무관한 편성 설정은 새 반에도 이어받음 (제약·주장처럼 학생에 묶인 설정은 제외) */
  var CARRY_OPTIONS = ['teamCount', 'genderBalance', 'genderSeparate', 'teamCountM', 'teamCountF', 'papsTolerance', 'includeBmi', 'schoolLevel', 'defaultGrade', 'papsGivenType', 'draftMode', 'creditFitnessWeight', 'draftTimerSec', 'draftAnonymous'];
  function addNewClass() {
    var s = St.get();
    var lbl = prompt('새로 추가할 반 이름을 입력하세요 (예: 1-4)\n현재 학급은 저장해 두고, 비어 있는 새 반을 엽니다.', suggestNextClass(s));
    if (lbl === null) return;
    lbl = lbl.trim();
    if (!lbl) return;
    if (lbl === (s.classLabel || '')) { toast('지금 화면이 이미 "' + lbl + '" 학급입니다.'); return; }
    if (St.listSaved().some(function (e) { return e.label === lbl; })) {
      if (confirm('"' + lbl + '" 학급은 이미 저장되어 있습니다. 그 학급으로 전환할까요?')) switchClass(lbl);
      return;
    }
    var keep = {};
    CARRY_OPTIONS.forEach(function (k) { if (s.options[k] !== undefined) keep[k] = s.options[k]; });
    var savedPrev = switchClass(lbl, null, true);
    St.update(function (ss) { Object.assign(ss.options, keep); }, { noUndo: true });
    St.putSaved(lbl, St.get());   // 학급 전환 목록에 바로 보이도록
    render();
    if (root.AgoraWizard && root.AgoraWizard.isOn()) root.AgoraWizard.go(0);
    toast('새 반 "' + lbl + '"을(를) 추가했습니다' + (savedPrev ? ' (이전 학급은 저장됨)' : '') + '. 1단계에서 자료를 올리세요.');
  }
  /* ---------- 학급 목록 순서 바꾸기 ---------- */
  var orderDrag = null;
  function renderOrderList() {
    var list = clear($('#class-order-list'));
    var saved = St.listSaved(), cur = St.get().classLabel || '';
    if (!saved.length) { list.appendChild(h('li', { class: 'empty', text: '저장된 학급이 없습니다. "학급 저장"이나 "＋ 새 반"으로 학급을 만들면 여기에 나타납니다.' })); }
    saved.forEach(function (e, i) {
      var ss = e.session || {};
      var li = h('li', { class: e.label === cur ? 'cur' : '', draggable: true, dataset: { label: e.label } },
        h('span', { class: 'grip', text: '⠿', title: '끌어서 옮기기' }),
        h('span', { class: 'nm' }, h('b', { text: e.label }), h('span', { class: 'hint', text: ' ' + (ss.students || []).length + '명' + (ss.result ? ' · 편성됨' : '') + (e.label === cur ? ' · 현재' : '') })),
        h('button', { class: 'btn small', type: 'button', disabled: i === 0, title: '위로', 'aria-label': e.label + ' 위로', onclick: function () { St.moveSaved(e.label, -1); afterOrderChange(e.label, -1); } }, '▲'),
        h('button', { class: 'btn small', type: 'button', disabled: i === saved.length - 1, title: '아래로', 'aria-label': e.label + ' 아래로', onclick: function () { St.moveSaved(e.label, 1); afterOrderChange(e.label, 1); } }, '▼'));
      li.addEventListener('dragstart', function (ev) { orderDrag = e.label; ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', e.label); } catch (err) { /* ignore */ } li.classList.add('dragging'); });
      li.addEventListener('dragend', function () { orderDrag = null; li.classList.remove('dragging'); $$('#class-order-list li').forEach(function (x) { x.classList.remove('over'); }); });
      li.addEventListener('dragover', function (ev) { if (orderDrag && orderDrag !== e.label) { ev.preventDefault(); li.classList.add('over'); } });
      li.addEventListener('dragleave', function () { li.classList.remove('over'); });
      li.addEventListener('drop', function (ev) {
        ev.preventDefault();
        if (!orderDrag || orderDrag === e.label) return;
        var labels = St.listSaved().map(function (x) { return x.label; });
        var from = labels.indexOf(orderDrag), to = labels.indexOf(e.label);
        if (from < 0 || to < 0) return;
        labels.splice(to, 0, labels.splice(from, 1)[0]);   // 끌어온 줄을 놓은 줄 자리에
        St.reorderSaved(labels);
        orderDrag = null;
        afterOrderChange();
      });
      list.appendChild(li);
    });
    $('#btn-order-sort').disabled = saved.length < 2;
  }
  /* 순서를 바꾼 뒤: 목록·상단 선택 칸을 다시 그리고, 방금 누른 ▲▼에 초점을 돌려줌 */
  function afterOrderChange(label, dir) {
    renderOrderList(); renderTop(St.get());
    if (!label) return;
    var li = $$('#class-order-list li').filter(function (x) { return x.dataset.label === label; })[0];
    if (!li) return;
    var btns = $$('button', li), b = btns[dir < 0 ? 0 : 1];
    if (b && b.disabled) b = btns[dir < 0 ? 1 : 0];
    if (b) b.focus();
  }
  function openOrderDialog() {
    var s = St.get();
    /* 현재 학급도 이름이 있으면 저장본을 갱신해 목록에 함께 보이게 */
    if (s.classLabel && s.students.length) St.putSaved(s.classLabel, s);
    renderOrderList(); renderTop(St.get());
    var dlg = $('#class-order');
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  }
  function closeOrderDialog() { var dlg = $('#class-order'); if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  /* 여러 반 파일의 모든 반을 각각 학급 저장본으로 (현재 학급과 같은 반은 현재 화면에 반영) */
  function saveAllClasses(kind, pd, col, groups) {
    var s = St.get();
    var cur = currentClassInfo(s);
    var det = pd.det;
    var meta = { fileName: pd.fileName, sheetName: col.sheetName, papsGivenType: det.mapping.papsGivenType, neis: det.meta && det.meta.neis };
    var known = groups.filter(function (g) { return g.key; }), done = [], curGroup = null;
    known.forEach(function (g) {
      if (cur && s.students.length && sameClass(g, cur)) { curGroup = g; return; }
      var ses = St.getSaved(g.label) || St.newSession();
      ses.classLabel = g.label;
      if (!ses.classInfo) ses.classInfo = { grade: g.grade, cls: g.cls };
      var rep = applyRecordsTo(ses, kind, g.recs, meta);
      rep.skipped = []; rep.duplicates = []; rep.rows = g.recs.length; rep.excluded = 0; rep.classCount = groups.length; rep.chosen = g.label;
      ses.imports[kind] = rep;
      if (meta.neis) inferGenderInto(ses);
      St.putSaved(g.label, ses);
      done.push(g.label);
    });
    if (curGroup) finishApply(kind, pd, curGroup.recs, col, { excluded: col.recs.length - curGroup.recs.length, classCount: groups.length, chosen: curGroup });
    else {
      pending[kind] = null; clear($('#map-' + kind));
      if (!s.students.length && done.length) St.loadSaved(done[0]);
    }
    render();
    toast(done.length + '개 반을 각각 저장했습니다' + (!s.students.length && done.length ? ' · ' + done[0] + ' 학급을 열었습니다' : '') + '. 상단 학급 전환에서 반을 바꿔 가며 편성하세요.');
  }

  /* 레코드를 세션 객체에 합침 (번호 기준, 없으면 이름). 반환: 검증 보고 */
  function applyRecordsTo(s, kind, recs, meta) {
    var byKey = {};
    s.students.forEach(function (st) { var k = keyOf(st); if (k) byKey[k] = st; });
    /*
     * 학생 연결 순서: ① 이름이 명단에 한 명뿐이면 이름으로 (학생이 설문에 학번을 잘못 적어도 연결)
     *               ② 아니면 번호로. 같은 번호인데 이름이 다르고 그 이름이 파일 안의 다른 학생이면 새 학생으로 둠.
     * 나이스(PAPS) 파일의 번호는 공식이므로, 이름으로 연결된 학생의 번호가 다르면 나이스 번호로 고침.
     */
    var byName = {};
    s.students.forEach(function (st) { if (st.name) { var nk = normName(st.name); (byName[nk] = byName[nk] || []).push(st); } });
    var fileNames = {}; recs.forEach(function (r) { if (r.name) fileNames[normName(r.name)] = (fileNames[normName(r.name)] || 0) + 1; });
    var added = 0, updated = 0, mism = [], touched = {}, renumbered = [], usedBy = {};
    recs.forEach(function (r) {
      var k = keyOf(r);
      var st = null;
      var nk = r.name ? normName(r.name) : null;
      if (nk && byName[nk] && byName[nk].length === 1 && fileNames[nk] === 1) st = byName[nk][0];
      if (!st && k && byKey[k]) {
        var cand = byKey[k];
        /* 번호는 같지만 이름이 다른데, 그 학생 이름이 파일에 따로 있으면 다른 학생 */
        if (!(cand.name && nk && normName(cand.name) !== nk && fileNames[normName(cand.name)])) st = cand;
      }
      if (st && usedBy[st.id] && usedBy[st.id] !== (nk || k)) st = null;   // 한 학생에 두 행이 붙지 않도록
      if (st && kind === 'paps' && r.no !== null && r.no !== undefined && st.no !== r.no && nk && st.name && normName(st.name) === nk) {
        renumbered.push({ name: st.name, from: st.no, to: r.no });
        st.no = r.no;
      }
      if (!st) {
        st = { id: k || ('u' + Date.now() + Math.floor(Math.random() * 1e6)), no: r.no === undefined ? null : r.no, name: r.name || null, gender: null,
               papsRaw: null, papsGiven: null, items: null, virtuesGiven: null, source: { paps: false, survey: false } };
        if (s.students.some(function (x) { return x.id === st.id; })) st.id = 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e6);
        s.students.push(st); if (k && !byKey[k]) byKey[k] = st; added++; touched[st.id] = true;
      } else {
        if (!touched[st.id]) { updated++; touched[st.id] = true; }   // 같은 학생이 두 행이면 한 명으로 셈
        /* 같은 번호인데 이름이 다르면 보고 (나이스 이름을 공식으로 봄) */
        if (st.name && r.name && normName(st.name) !== normName(r.name)) {
          mism.push({ no: r.no, roster: st.name, file: r.name, kept: kind === 'paps' ? 'file' : 'roster' });
          if (kind === 'paps') st.name = r.name;
        }
      }
      usedBy[st.id] = nk || k;
      if (!st.source) st.source = { paps: false, survey: false };
      if (!st.name && r.name) st.name = r.name;
      if (r.gender) { st.gender = r.gender; st.genderInferred = false; }
      if (r.grade && !st.grade) st.grade = r.grade;
      if (r.cls !== null && r.cls !== undefined && (st.cls === null || st.cls === undefined)) st.cls = r.cls;
      if (kind === 'paps') {
        st.source.paps = true;
        if (r.papsRaw) st.papsRaw = r.papsRaw;
        if (r.papsGiven !== null && r.papsGiven !== undefined) st.papsGiven = r.papsGiven;
        st.papsNeis = r.papsNeis || null;
        if (r.items && !st.items) st.items = r.items;
        if (r.virtuesGiven && !st.virtuesGiven) st.virtuesGiven = r.virtuesGiven;
      } else {
        st.source.survey = true;
        if (r.items) st.items = r.items;
        if (r.virtuesGiven) st.virtuesGiven = r.virtuesGiven;
        if (r.papsRaw && !st.papsRaw) st.papsRaw = r.papsRaw;
        if (r.papsGiven !== null && r.papsGiven !== undefined && st.papsGiven === null) st.papsGiven = r.papsGiven;
        if (r.papsNeis && !st.papsNeis) st.papsNeis = r.papsNeis;
      }
    });
    sortStudents(s.students);
    /* 학급 식별 정보 보완 */
    var withCls = recs.find(function (r) { return r.cls !== null && r.cls !== undefined; });
    if (!s.classInfo && withCls) s.classInfo = { grade: withCls.grade, cls: withCls.cls };
    else if (s.classInfo && (s.classInfo.grade === null || s.classInfo.grade === undefined)) {
      var wg = recs.find(function (r) { return r.cls === s.classInfo.cls && r.grade !== null && r.grade !== undefined; });
      if (wg) s.classInfo.grade = wg.grade;
    }
    if (!s.classLabel && s.classInfo) s.classLabel = classLabelOf(s.classInfo);
    if (meta.papsGivenType) s.options.papsGivenType = meta.papsGivenType;
    return { fileName: meta.fileName, sheetName: meta.sheetName, rowCount: recs.length, added: added, updated: updated, nameMismatch: mism, renumbered: renumbered, at: new Date().toISOString() };
  }
  function applyImport(kind, recs, meta) {
    St.update(function (s) { s.imports[kind] = applyRecordsTo(s, kind, recs, meta); });
  }
  function sortStudents(list) {
    list.sort(function (a, b) {
      var an = a.no === null || a.no === undefined, bn = b.no === null || b.no === undefined;
      if (!an && !bn) return a.no - b.no;
      if (!an) return -1; if (!bn) return 1;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
  }

  function renderImportStatus(s) {
    ['paps', 'survey'].forEach(function (kind) {
      var el = clear($('#import-status-' + kind));
      var im = s.imports && s.imports[kind];
      var cnt = s.students.filter(function (st) { return st.source && st.source[kind]; }).length;
      if (im) {
        var nStu = (im.added !== undefined && im.updated !== undefined) ? im.added + im.updated : im.rowCount;
        var line = h('div', { class: 'ok' }, '✔ ' + im.fileName + (im.sheetName && im.sheetName !== 'CSV' && im.sheetName !== 'sheet1' ? ' / ' + im.sheetName : '') + ' · ' + nStu + '명 반영'
          + (im.added !== undefined && im.updated !== undefined ? ' (새로 ' + im.added + (im.updated ? ' · 기존 갱신 ' + im.updated : '') + (im.rowCount > nStu ? ' · ' + im.rowCount + '행' : '') + ')' : '') + (im.chosen ? ' · ' + im.chosen + ' 학급' : '') + ' · 현재 ' + cnt + '명');
        if (lastImport[kind] && lastImport[kind].fileName === im.fileName) {
          line.appendChild(h('button', { class: 'btn ghost small adv', type: 'button', style: 'margin-left:.5rem', title: '열 인식이 잘못됐다면 직접 고쳐 다시 반영', onclick: function () { pending[kind] = lastImport[kind]; renderMapping(kind); } }, '열 매핑 수정'));
          if (im.excluded) line.appendChild(h('button', { class: 'btn ghost small', type: 'button', style: 'margin-left:.3rem', title: '이 파일의 다른 반을 불러오거나 모든 반을 각각 저장', onclick: function () {
            var pd = lastImport[kind]; pending[kind] = pd; var col = collectRecords(pd); renderClassPanel(kind, pd, col, groupByClass(col.recs), currentClassInfo(St.get()));
          } }, '다른 반 보기'));
        }
        el.appendChild(line);
        /* 검증 보고 */
        var issues = [];
        if (im.excluded) issues.push('다른 반 ' + (im.excluded - (im.unknownCount || 0)) + '명 제외' + (im.classCount ? ' (파일에 ' + im.classCount + '개 반)' : '') + (im.unknownCount ? ' · 반 미상 ' + im.unknownCount + '명 제외' : ''));
        if (im.skipped && im.skipped.length) issues.push('건너뛴 행 ' + im.skipped.length);
        if (im.duplicates && im.duplicates.length) issues.push('번호 중복 ' + im.duplicates.length + '건');
        if (im.nameMismatch && im.nameMismatch.length) issues.push('이름 불일치 ' + im.nameMismatch.length + '건');
        if (im.renumbered && im.renumbered.length) issues.push('번호 정정 ' + im.renumbered.length + '명');
        if (im.partial) issues.push('응답 일부 누락 ' + im.partial + '명');
        if (im.noData) issues.push('점수 없는 행 ' + im.noData);
        if (issues.length) {
          var dt = h('details', { class: 'import-detail' }, h('summary', { text: '⚠ 검증: ' + issues.join(' · ') }));
          var ul = h('ul');
          (im.skipped || []).slice(0, 30).forEach(function (x) { ul.appendChild(h('li', { text: (x.sheet || '') + x.row + '행 건너뜀 — ' + x.reason + (x.text ? ' "' + x.text + '"' : '') })); });
          if ((im.skipped || []).length > 30) ul.appendChild(h('li', { class: 'hint', text: '… 외 ' + (im.skipped.length - 30) + '행' }));
          (im.duplicates || []).forEach(function (d) { ul.appendChild(h('li', { text: (d.key ? d.key + ' ' : '') + (d.no !== null && d.no !== undefined ? d.no + '번' : d.name) + ' — ' + d.rows.join(', ') + '행에 중복 (마지막 행 적용)' })); });
          (im.nameMismatch || []).forEach(function (x) { ul.appendChild(h('li', { text: x.no + '번 이름 불일치 — 명단 "' + x.roster + '" / 파일 "' + x.file + '" → ' + (x.kept === 'file' ? '나이스 파일 이름으로 바꿈' : '명단 이름 유지') + '. 같은 번호의 다른 학생이라면 반이 섞였는지 확인하세요.' })); });
          (im.renumbered || []).forEach(function (x) { ul.appendChild(h('li', { text: x.name + ' — 설문의 번호 ' + x.from + '번을 나이스 번호 ' + x.to + '번으로 고쳤습니다 (이름으로 연결).' })); });
          if (im.partial) ul.appendChild(h('li', { text: '32문항 중 일부에 응답이 없는 학생 ' + im.partial + '명 — 덕목별 5문항 이상이면 평균을 쓰고, 미만이면 학급 평균으로 대체합니다.' }));
          if (im.noData) ul.appendChild(h('li', { text: '점수 열이 비어 있는 행 ' + im.noData + '개 — 명단에는 들어가며 결측(대체)으로 표시됩니다.' }));
          if (im.excluded) ul.appendChild(h('li', { text: '다른 반 ' + im.excluded + '명은 반영하지 않았습니다. 그 반을 편성하려면 "다른 반 보기"에서 반을 고르거나 모든 반을 각각 저장하세요.' }));
          dt.appendChild(ul);
          el.appendChild(dt);
        }
      }
      else el.appendChild(h('div', { class: 'hint' }, cnt ? cnt + '명에게 자료가 있습니다.' : '아직 불러온 자료가 없습니다.'));
    });
  }

  function bindImportEvents() {
    $$('.file-input').forEach(function (inp) {
      inp.addEventListener('change', function () { if (inp.files && inp.files[0]) loadRowsFromFile(inp.dataset.kind, inp.files[0]); inp.value = ''; });
    });
    $$('.dropzone').forEach(function (dz) {
      dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
      dz.addEventListener('drop', function (e) {
        e.preventDefault(); dz.classList.remove('over');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) loadRowsFromFile(dz.dataset.kind, f);
      });
    });
    $$('.btn-paste').forEach(function (b) { b.addEventListener('click', function () { var box = $('.paste-box[data-kind=' + b.dataset.kind + ']'); box.hidden = !box.hidden; if (!box.hidden) $('textarea', box).focus(); }); });
    $$('.btn-paste-cancel').forEach(function (b) { b.addEventListener('click', function () { $('.paste-box[data-kind=' + b.dataset.kind + ']').hidden = true; }); });
    $$('.btn-paste-apply').forEach(function (b) {
      b.addEventListener('click', function () {
        var box = $('.paste-box[data-kind=' + b.dataset.kind + ']');
        var text = $('textarea', box).value;
        if (!text.trim()) { toast('붙여넣은 내용이 없습니다.', true); return; }
        setPending(b.dataset.kind, '붙여넣은 표', [{ name: 'CSV', rows: P.parseDelimitedText(text) }]);
        box.hidden = true;
      });
    });
  }

  /* ============================================================
   * 2. 명단
   * ============================================================ */
  function renderRoster(s, prep) {
    var body = clear($('#roster-body'));
    var byId = {}; prep.forEach(function (p) { byId[p.id] = p; });
    if (!s.students.length) {
      body.appendChild(h('tr', null, h('td', { colspan: 10, class: 'empty', text: '1단계에서 자료를 불러오거나 "학생 추가"로 직접 입력하세요.' })));
    }
    s.students.forEach(function (st) {
      var p = byId[st.id];
      var inactive = !St.isActive(st);
      var tr = h('tr', { dataset: { id: st.id }, class: inactive ? 'inactive' : '', title: inactive ? (St.STATUS_LABEL[st.status] || '') + ' — 오늘 편성에서 제외' : '' });
      tr.appendChild(h('td', null, h('input', { type: 'number', min: 1, 'data-field': 'no', value: st.no === null || st.no === undefined ? '' : st.no, title: '출석번호 (파일의 번호 그대로)' })));
      tr.appendChild(h('td', null, h('input', { type: 'text', 'data-field': 'name', value: st.name || '', placeholder: '이름' })));
      tr.appendChild(h('td', null, h('div', { class: 'gcell' },
        h('select', { 'data-field': 'gender', class: st.gender && st.genderInferred ? 'inferred' : '', title: st.genderInferred ? '나이스 점수와 기준표를 대조해 추정한 성별입니다. 틀리면 고쳐 주세요.' : '' },
          h('option', { value: '', text: '–', selected: !st.gender }), h('option', { value: '남', text: '남', selected: st.gender === '남' }), h('option', { value: '여', text: '여', selected: st.gender === '여' })),
        st.gender && st.genderInferred ? h('span', { class: 'badge', text: '추정', title: '나이스 점수와 기준표를 대조해 추정한 성별' }) : null)));
      /* PAPS */
      var papsTd = h('td', { class: 'num' });
      var d = p.papsDetail;
      if (st.papsRaw) {
        var lines = d && d.items ? Object.keys(d.items).map(function (k) {
          var it = d.items[k];
          return T.ITEMS[k].label + ' ' + it.value + T.ITEMS[k].unitLabel + ' → ' + it.points + '점 (' + it.grade + '등급' + (it.category ? ' · ' + it.category : '') + ')';
        }).join('\n') : '';
        var srcText = d && d.source === 'neis' ? '나이스 조회 양식의 영역별 점수를 그대로 사용'
          : d && d.source === 'official' ? '공식 기준표 (' + d.gradeKey + ' ' + d.gender + ')' : (d && d.source === 'relative' ? '학급 내 상대점수 (성별 또는 학년 기준표 없음)' : '');
        var scaledText = d && d.scaled ? '\n※ ' + d.nAreas + '개 영역만 있어 100점 만점으로 환산 (없음: ' + d.missing.join(', ') + ')' : '';
        /* 총점 칸은 교사가 직접 고칠 수 있음 (기록과 실제 수행 능력의 차이가 클 때). 원래 점수는 data-base 에 두고, 비우거나 같은 값이면 수정 해제 */
        var over = !!(d && d.overridden);
        var baseTotal = over ? d.computedTotal : (p.papsImputed ? null : p.papsPoints);
        var hasBase = typeof baseTotal === 'number' && isFinite(baseTotal);
        var shown = over ? st.papsOverride : (hasBase ? Math.round(baseTotal * 10) / 10 : '');
        papsTd.appendChild(h('input', { type: 'number', step: 'any', min: 0, max: 100, 'data-field': 'papsOverride', 'data-base': hasBase ? baseTotal : '', value: shown,
          class: 'paps-edit' + (over ? ' edited' : ''), placeholder: p.papsImputed ? fmt(p.papsPoints, 0) : '',
          title: srcText + '\n' + lines + scaledText + '\n\n숫자를 고치면 교사 수정 점수로 편성합니다. 칸을 비우면 원래 점수로 돌아갑니다.' }));
        papsTd.appendChild(h('span', { class: 'unit', text: '점' }));
        papsTd.appendChild(h('span', { class: 'badge', text: p.papsGrade + '등급' }));
        if (over) {
          papsTd.appendChild(h('span', { class: 'badge warn', text: '교사 수정', title: '교사가 직접 고친 점수입니다.' + (hasBase ? ' 원래 점수 ' + fmt(baseTotal, 1) + '점' : '') }));
          papsTd.appendChild(h('button', { class: 'btn ghost small', type: 'button', 'data-action': 'reset-paps', title: hasBase ? '원래 점수(' + fmt(baseTotal, 1) + '점)로 되돌리기' : '수정한 점수 지우기' }, '↺'));
        }
        if (d && d.source === 'neis') papsTd.appendChild(h('span', { class: 'badge ok', text: '나이스', title: '나이스가 계산한 점수' }));
        if (d && d.source === 'relative') papsTd.appendChild(h('span', { class: 'badge warn', text: '상대', title: '성별(또는 학년) 기준표가 없어 학급 내 백분위로 매긴 점수입니다. 성별을 입력하면 공식 점수로 바뀝니다.' }));
        if (d && d.scaled) papsTd.appendChild(h('span', { class: 'badge warn', text: '환산', title: '일부 영역 기록이 없어 100점 만점으로 환산했습니다' }));
      } else {
        papsTd.appendChild(h('input', { type: 'number', step: 'any', 'data-field': 'papsGiven', value: st.papsGiven === null || st.papsGiven === undefined ? '' : st.papsGiven, placeholder: s.options.papsGivenType === 'grade' ? '등급' : '총점', style: 'max-width:5.5em' }));
        if (!p.papsImputed) papsTd.appendChild(h('span', { class: 'hint', text: ' → ' + fmt(p.papsPoints, 0) + '점' }));
      }
      if (p.papsImputed) papsTd.appendChild(h('span', { class: 'badge warn', text: '대체', title: 'PAPS 자료가 없어 학급 평균 점수로 채웠습니다' }));
      tr.appendChild(papsTd);
      /* 덕목 */
      VK.forEach(function (k) {
        var td = h('td', { class: 'num' });
        if (st.items) td.appendChild(h('span', { title: '32문항 응답에서 계산' }, fmt(p.virtues[k], 2)));
        else td.appendChild(h('input', { type: 'number', step: '0.01', min: 1, max: 5, 'data-field': 'v_' + k, value: st.virtuesGiven && st.virtuesGiven[k] !== null && st.virtuesGiven[k] !== undefined ? st.virtuesGiven[k] : '', placeholder: '1~5', style: 'max-width:4.5em' }));
        tr.appendChild(td);
      });
      /* 참여 상태 + 자료 상태 */
      var stTd = h('td');
      stTd.appendChild(h('select', { 'data-field': 'status', class: 'status-select' + (inactive ? ' off' : ''), title: '결석·활동 제한·기록/심판 학생은 오늘 편성에서 빠집니다. 다시 "참여"로 바꾸면 원래 팀으로 돌아옵니다.' },
        h('option', { value: '', text: '참여', selected: !inactive }),
        Object.keys(St.STATUS_LABEL).map(function (k) { return h('option', { value: k, text: St.STATUS_LABEL[k], selected: st.status === k }); })));
      var src = st.source || {};
      stTd.appendChild(h('span', { class: 'badge ' + (src.paps || st.papsRaw || st.papsGiven !== null ? 'ok' : 'bad'), text: (src.paps || st.papsRaw || st.papsGiven !== null) ? 'PAPS' : 'PAPS 없음' }));
      stTd.appendChild(h('span', { class: 'badge ' + (st.items || st.virtuesGiven ? 'ok' : 'bad'), text: (st.items || st.virtuesGiven) ? (st.items ? '32문항' : '4덕목') : '설문 없음' }));
      if (p.virtueImputed) stTd.appendChild(h('span', { class: 'badge warn', text: '인성 대체', title: '일부 덕목이 결측이라 학급 평균으로 채웠습니다' }));
      if (!st.gender) stTd.appendChild(h('span', { class: 'badge', text: '성별 미상' }));
      tr.appendChild(stTd);
      tr.appendChild(h('td', null, h('button', { class: 'btn ghost small danger', type: 'button', title: '삭제', 'data-action': 'delete' }, '✕')));
      body.appendChild(tr);
    });
    /* 요약 */
    var m = s.students.filter(function (x) { return x.gender === '남'; }).length;
    var f = s.students.filter(function (x) { return x.gender === '여'; }).length;
    var u = s.students.length - m - f;
    var hasP = prep.filter(function (p) { return !p.papsImputed; }).length;
    var hasV = prep.filter(function (p) { return !p.virtueImputed && (p.items || p.virtuesGiven); }).length;
    var rel = prep.filter(function (p) { return p.papsDetail && p.papsDetail.source === 'relative'; }).length;
    var both = s.students.filter(function (x) { return x.source && x.source.paps && x.source.survey; }).length;
    var onlyP = s.students.filter(function (x) { return x.source && x.source.paps && !x.source.survey; }).length;
    var onlyS = s.students.filter(function (x) { return x.source && !x.source.paps && x.source.survey; }).length;
    var inact = St.inactiveStudents(s).length;
    var edited = prep.filter(function (p) { return p.papsDetail && p.papsDetail.overridden; }).length;
    var link =(s.imports && s.imports.paps && s.imports.survey) ? ' · 두 자료 연결 ' + both + '명' + (onlyP ? ' · PAPS만 ' + onlyP : '') + (onlyS ? ' · 설문만 ' + onlyS : '') : '';
    $('#roster-summary').textContent = s.students.length ? ((s.classLabel ? s.classLabel + ' 학급 · ' : '') + '총 ' + s.students.length + '명 · 남 ' + m + ' 여 ' + f + (u ? ' 미상 ' + u : '') + ' · PAPS ' + hasP + '명' + (rel ? ' (상대점수 ' + rel + '명)' : '') + (edited ? ' (교사 수정 ' + edited + '명)' : '') + ' · 인성 ' + hasV + '명' + link + (inact ? ' · 오늘 불참 ' + inact + '명 (편성 ' + (s.students.length - inact) + '명)' : '')) : '';
  }

  function bindRosterEvents() {
    $('#roster-body').addEventListener('change', function (e) {
      var inp = e.target, tr = inp.closest('tr'), field = inp.dataset.field;
      if (!tr || !field) return;
      var id = tr.dataset.id, val = inp.value;
      St.update(function (s) {
        var st = s.students.find(function (x) { return x.id === id; });
        if (!st) return;
        if (field === 'no') st.no = P.parseNo(val);
        else if (field === 'name') st.name = String(val).trim() || null;
        else if (field === 'gender') { st.gender = val || null; st.genderInferred = false; }
        else if (field === 'status') st.status = val || '';
        else if (field === 'papsGiven') st.papsGiven = S.toNum(val);
        else if (field === 'papsOverride') {
          /* 교사 수정 총점: 비우거나 원래 점수와 같으면 수정 해제 */
          var ov = S.toNum(val), base = S.toNum(inp.dataset.base);
          if (ov !== null) ov = Math.max(0, Math.min(100, ov));
          st.papsOverride = (ov === null || (base !== null && Math.abs(ov - base) < 0.05)) ? null : ov;
        }
        else if (field.slice(0, 2) === 'v_') { st.virtuesGiven = st.virtuesGiven || {}; st.virtuesGiven[field.slice(2)] = S.toNum(val); if (VK.every(function (k) { return st.virtuesGiven[k] === null || st.virtuesGiven[k] === undefined; })) st.virtuesGiven = null; }
        if (field === 'no' || field === 'name') sortStudents(s.students);
      });
    });
    $('#roster-body').addEventListener('click', function (e) {
      var rst = e.target.closest('button[data-action=reset-paps]');
      if (rst) {
        var rid = rst.closest('tr').dataset.id;
        St.update(function (s) { var x = s.students.find(function (y) { return y.id === rid; }); if (x) x.papsOverride = null; });
        toast('원래 PAPS 점수로 되돌렸습니다.');
        return;
      }
      var btn = e.target.closest('button[data-action=delete]');
      if (!btn) return;
      var id = btn.closest('tr').dataset.id;
      var st = St.get().students.find(function (x) { return x.id === id; });
      if (!st || !confirm(label(st) + ' 학생을 명단에서 삭제할까요?')) return;
      St.update(function (s) {
        s.students = s.students.filter(function (x) { return x.id !== id; });
        if (s.result) s.result.teams = s.result.teams.map(function (t) { return t.filter(function (x) { return x !== id; }); });
        s.options.together = (s.options.together || []).filter(function (p) { return p.indexOf(id) < 0; });
        s.options.apart = (s.options.apart || []).filter(function (p) { return p.indexOf(id) < 0; });
        if (s.options.pinned) delete s.options.pinned[id];
      });
    });
    $('#btn-add-row').addEventListener('click', function () {
      St.update(function (s) {
        var maxNo = s.students.reduce(function (mx, x) { return x.no !== null && x.no > mx ? x.no : mx; }, 0);
        s.students.push({ id: 'u' + Date.now(), no: maxNo + 1, name: '', gender: null, papsRaw: null, papsGiven: null, items: null, virtuesGiven: null, source: { paps: false, survey: false } });
      });
      var rows = $$('#roster-body tr'); var last = rows[rows.length - 1];
      if (last) { var nm = $('input[data-field=name]', last); if (nm) nm.focus(); }
    });
  }

  /* ============================================================
   * 3. 설정·제약
   * ============================================================ */
  function setIfIdle(el, val, prop) {
    if (document.activeElement === el) return;
    if (prop === 'checked') el.checked = !!val; else el.value = val;
  }
  function renderSettings(s, prep) {
    var o = s.options;
    setIfIdle($('#opt-teamCount'), o.teamCount);
    setIfIdle($('#opt-genderBalance'), o.genderBalance, 'checked');
    setIfIdle($('#opt-papsTolerance'), o.papsTolerance);
    $('#tau-value').textContent = Number(o.papsTolerance).toFixed(1);
    setIfIdle($('#opt-includeBmi'), o.includeBmi, 'checked');
    setIfIdle($('#opt-schoolLevel'), o.schoolLevel || '중');
    setIfIdle($('#opt-defaultGrade'), o.defaultGrade || 1);
    setIfIdle($('#opt-papsGivenType'), o.papsGivenType);
    $$('input[name=draftMode]').forEach(function (r) { r.checked = (o.draftMode || 'auto') === r.value; });
    var N = prep.length, K = Math.max(1, o.teamCount | 0), inact = s.students.length - N;
    $('#team-size-hint').textContent = N ? ('참여 학생 ' + N + '명' + (inact ? ' (불참 ' + inact + '명 제외)' : '') + ' → 팀당 ' + Math.floor(N / K) + (N % K ? '~' + Math.ceil(N / K) : '') + '명') : '';
    /* 남녀 따로 편성 */
    var sep = !!o.genderSeparate;
    setIfIdle($('#opt-genderSeparate'), sep, 'checked');
    setIfIdle($('#opt-teamCountM'), o.teamCountM || Math.max(1, Math.round(K / 2)));
    setIfIdle($('#opt-teamCountF'), o.teamCountF || Math.max(1, Math.round(K / 2)));
    $('#split-counts').hidden = !sep;
    $('#teamCount-wrap').hidden = sep;
    $('#genderBalance-wrap').hidden = sep;
    var sw = $('#split-hint');
    if (sep) {
      var nm = prep.filter(function (p) { return p.gender === '남'; }).length, nf = prep.filter(function (p) { return p.gender === '여'; }).length, nu = N - nm - nf;
      var Km = Math.max(1, o.teamCountM | 0), Kf = Math.max(1, o.teamCountF | 0);
      var per = function (n, k) { return n ? Math.floor(n / k) + (n % k ? '~' + Math.ceil(n / k) : '') : 0; };
      sw.textContent = N ? ('남학생 ' + nm + '명 → 남자 팀 ' + Km + '개 (팀당 ' + per(nm, Km) + '명) · 여학생 ' + nf + '명 → 여자 팀 ' + Kf + '개 (팀당 ' + per(nf, Kf) + '명). 팀 간 균형은 같은 성별 안에서 맞춥니다.' + (nu ? ' ⚠ 성별 미상 ' + nu + '명 — 2단계 명단에서 성별을 채워야 편성할 수 있습니다.' : '')) : '';
      sw.classList.toggle('warn-text', nu > 0);
    } else sw.textContent = '';
    /* 자료 누락 경고 */
    var missV = prep.filter(function (p) { return p.virtueImputed; }).length, missP = prep.filter(function (p) { return p.papsImputed; }).length;
    var mw = $('#missing-warn');
    if (mw) {
      var ratio = N ? Math.max(missV, missP) / N : 0;
      mw.hidden = !(missV || missP);
      mw.textContent = (missV || missP) ? ('⚠ 자료가 없어 학급 평균으로 채운 학생: 인성 ' + missV + '명 · PAPS ' + missP + '명 (' + Math.round(ratio * 100) + '%). ' + (ratio >= 0.2 ? '누락이 많으면 균형 수치가 실제보다 좋게 보입니다. 편성 전에 설문을 다시 받거나, 명단에서 해당 학생을 팀 고정으로 직접 배치하는 것을 권장합니다.' : '해당 학생은 어느 팀에 가도 균형 수치를 바꾸지 않습니다.')) : '';
    }
    renderConstraints(s);
  }
  function bindSettingsEvents() {
    function upd(key, parse) {
      return function (e) {
        var v = parse ? parse(e.target) : e.target.value;
        St.update(function (s) { s.options[key] = v; }, { noUndo: true });
      };
    }
    $('#opt-teamCount').addEventListener('change', upd('teamCount', function (el) { var v = parseInt(el.value, 10); return isNaN(v) || v < 1 ? 1 : Math.min(20, v); }));
    $('#opt-genderBalance').addEventListener('change', upd('genderBalance', function (el) { return el.checked; }));
    $('#opt-genderSeparate').addEventListener('change', upd('genderSeparate', function (el) { return el.checked; }));
    $('#opt-teamCountM').addEventListener('change', upd('teamCountM', function (el) { var v = parseInt(el.value, 10); return isNaN(v) || v < 1 ? 1 : Math.min(12, v); }));
    $('#opt-teamCountF').addEventListener('change', upd('teamCountF', function (el) { var v = parseInt(el.value, 10); return isNaN(v) || v < 1 ? 1 : Math.min(12, v); }));
    $('#opt-papsTolerance').addEventListener('input', function (e) { $('#tau-value').textContent = Number(e.target.value).toFixed(1); });
    $('#opt-papsTolerance').addEventListener('change', upd('papsTolerance', function (el) { return parseFloat(el.value); }));
    $('#opt-includeBmi').addEventListener('change', upd('includeBmi', function (el) { return el.checked; }));
    $('#opt-schoolLevel').addEventListener('change', upd('schoolLevel'));
    $('#opt-defaultGrade').addEventListener('change', upd('defaultGrade', function (el) { var v = parseInt(el.value, 10); return isNaN(v) || v < 1 ? 1 : Math.min(6, v); }));
    $('#opt-papsGivenType').addEventListener('change', upd('papsGivenType'));
    $$('input[name=draftMode]').forEach(function (r) { r.addEventListener('change', function () { if (r.checked) St.update(function (s) { s.options.draftMode = r.value; }, { noUndo: true }); }); });
    /* 편성 화면은 이름 붙인 창 하나로 열어 창이 쌓이지 않게 하고, 저장 후 스스로 닫을 수 있게 함 */
    $$('a[href="draft.html"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        St.persistNow();
        var w = null;
        try { w = window.open('draft.html', 'agora-draft'); } catch (err) { w = null; }
        if (w) { e.preventDefault(); try { w.focus(); } catch (err) { /* ignore */ } }
      });
    });
    /* 편성 화면(다른 탭)에서 저장하면 즉시 반영 */
    window.addEventListener('storage', function (e) { if (e.key === St.KEY) { St.load(); render(); } });
  }

  function studentSelect(s, attrs) {
    return h('select', attrs, [h('option', { value: '', text: '학생 선택' })].concat(s.students.map(function (st) { return h('option', { value: st.id, text: label(st) }); })));
  }
  function renderConstraints(s) {
    var box = clear($('#constraints'));
    var byId = {}; s.students.forEach(function (st) { byId[st.id] = st; });
    var o = s.options;
    var grid = h('div', { class: 'cons-grid' });

    function pairBox(title, key, hint) {
      var ul = h('ul');
      (o[key] || []).forEach(function (pr, i) {
        var a = byId[pr[0]], b = byId[pr[1]];
        ul.appendChild(h('li', null, h('span', null, (a ? label(a) : pr[0]) + (key === 'together' ? ' + ' : ' ↔ ') + (b ? label(b) : pr[1])),
          h('button', { class: 'btn ghost small', type: 'button', onclick: function () { St.update(function (ss) { ss.options[key].splice(i, 1); }); } }, '✕')));
      });
      if (!(o[key] || []).length) ul.appendChild(h('li', { class: 'hint', text: hint }));
      var selA = studentSelect(s), selB = studentSelect(s);
      var add = h('button', { class: 'btn small', type: 'button', onclick: function () {
        if (!selA.value || !selB.value || selA.value === selB.value) { toast('서로 다른 두 학생을 고르세요.', true); return; }
        St.update(function (ss) { ss.options[key] = ss.options[key] || []; ss.options[key].push([selA.value, selB.value]); });
      } }, '추가');
      return h('div', { class: 'cons-box' }, h('h4', { text: title }), ul, h('div', { class: 'row' }, selA, selB, add));
    }
    grid.appendChild(pairBox('함께 넣기', 'together', '같은 팀에 넣을 두 학생'));
    grid.appendChild(pairBox('떨어뜨리기', 'apart', '다른 팀에 넣을 두 학생'));

    /* 고정 */
    var ul = h('ul');
    var pinned = o.pinned || {};
    Object.keys(pinned).forEach(function (id) {
      var st = byId[id]; if (!st) return;
      ul.appendChild(h('li', null, h('span', null, label(st) + ' → ' + teamName(+pinned[id])),
        h('button', { class: 'btn ghost small', type: 'button', onclick: function () { St.update(function (ss) { delete ss.options.pinned[id]; }); } }, '✕')));
    });
    if (!Object.keys(pinned).length) ul.appendChild(h('li', { class: 'hint', text: '특정 팀에 고정할 학생' }));
    var selS = studentSelect(s);
    var selT = h('select', null, Array.from({ length: totalTeamCount(s) }, function (_, t) { return h('option', { value: t, text: teamName(t) }); }));
    var addP = h('button', { class: 'btn small', type: 'button', onclick: function () {
      if (!selS.value) { toast('학생을 고르세요.', true); return; }
      St.update(function (ss) { ss.options.pinned = ss.options.pinned || {}; ss.options.pinned[selS.value] = +selT.value; });
    } }, '추가');
    grid.appendChild(h('div', { class: 'cons-box' }, h('h4', { text: '팀 고정' }), ul, h('div', { class: 'row' }, selS, selT, addP)));
    box.appendChild(grid);
  }

  /* ============================================================
   * 편성 (편성 화면 draft.html 에서 진행) — 여기서는 수동 조정만
   * ============================================================ */
  function build(seed) {
    /* 개발·검증용: 편성 화면 없이 바로 자동 편성 */
    var s = St.get();
    if (!s.students.length) { toast('먼저 학생 자료를 불러오세요.', true); return; }
    var prep = prepare(s);
    var opt = Object.assign({}, s.options, { seed: seed === undefined ? s.options.seed : seed });
    var res = A.buildTeams(prep, opt);
    St.update(function (ss) {
      ss.options.seed = opt.seed;
      ss.result = { teams: res.teams, original: res.teams.map(function (t) { return t.slice(); }), seed: res.seed, log: res.log, builtAt: new Date().toISOString(), meta: res.meta, source: 'auto', split: (res.meta && res.meta.separate) || null, note: '' };
      ss.manualEdits = false;
    });
    toast('팀 편성 완료 (공정성 ' + res.equity + '점)');
  }
  /*
   * 새로운 조합으로 다시 편성 (교사 편성): 팀 평균은 비슷하게 유지하면서, 지금·지난 편성에서 같은 팀이었던
   * 학생들이 되도록 다시 만나지 않게 새로 짬. 3단계의 현재 설정(팀 수·성별·허용편차·제약)을 그대로 씀.
   */
  function remix() {
    var s = St.get();
    var teamsNow = sanitizeTeams(s);
    if (!teamsNow) { toast('먼저 3단계에서 편성을 마치세요.', true); return; }
    var prep = prepare(s);
    if (!prep.length) { toast('참여 학생이 없습니다.', true); return; }
    var lose = [];
    if (s.result.source === 'draft' && s.result.mode && s.result.mode !== 'auto') lose.push('학생들이 직접 지명한 ' + ({ pick: '팀별 드래프트', credit: '크레딧 드래프트' }[s.result.mode] || '드래프트') + ' 결과');
    if (s.manualEdits) lose.push('수동으로 옮긴 내용');
    if (lose.length && !confirm('앱이 균형에 맞춰 팀을 새로 짭니다. ' + lose.join(' · ') + '은(는) 새 편성으로 바뀝니다. 계속할까요?\n(상단 "되돌리기"로 되돌릴 수 있습니다)')) return;
    var opt = Object.assign({}, s.options, { seed: 1 + Math.floor(Math.random() * 1e6), avoid: St.pastTeams(s) });
    var res = A.buildTeams(prep, opt);
    var sh = A.sharedPairs(teamsNow, res.teams);
    var msg = '새로운 조합으로 편성했습니다 — 직전 편성과 같은 팀인 짝은 ' + sh.total + '쌍 중 ' + sh.shared + '쌍입니다.';
    St.update(function (ss) {
      St.rememberResult(ss, res.teams);   // 바뀌기 전 결과는 지난 편성으로 남김 (다음에도 덜 겹치게)
      var wasSplit = !!(ss.result && ss.result.split), isSplit = !!(res.meta && res.meta.separate);
      if (wasSplit !== isSplit) ss.teamNames = [];   // "남 1팀"·"1팀" 이름 체계가 달라짐
      ss.options.seed = opt.seed;
      ss.result = { teams: res.teams, original: res.teams.map(function (t) { return t.slice(); }), seed: res.seed, log: res.log.concat([msg]), builtAt: new Date().toISOString(),
        meta: res.meta, source: 'auto', mode: 'auto', remix: true, split: (res.meta && res.meta.separate) || null, note: '' };
      ss.manualEdits = false;
      ss.draft = null;                    // 편성 화면에 남아 있던 이전 진행 상태는 지움
      if (ss.teamNames && ss.teamNames.length !== res.teams.length) ss.teamNames = [];
    });
    selectedMember = null;
    toast(msg + ' (공정성 ' + res.equity + '점)');
  }
  /* 수동 조정 전 편성 직후 상태를 남겨 둠 (복원용) */
  function keepOriginal(s) { if (s.result && !s.result.original) s.result.original = s.result.teams.map(function (t) { return t.slice(); }); }
  function moveStudent(id, toTeam) {
    St.update(function (s) {
      if (!s.result) return;
      keepOriginal(s);
      s.result.teams = s.result.teams.map(function (t) { return t.filter(function (x) { return x !== id; }); });
      while (s.result.teams.length <= toTeam) s.result.teams.push([]);
      s.result.teams[toTeam].push(id);
      s.manualEdits = true;
    });
  }
  function swapStudents(a, b) {
    St.update(function (s) {
      if (!s.result) return;
      var ta = -1, tb = -1;
      s.result.teams.forEach(function (t, i) { if (t.indexOf(a) >= 0) ta = i; if (t.indexOf(b) >= 0) tb = i; });
      if (ta < 0 || tb < 0 || ta === tb) return;
      keepOriginal(s);
      s.result.teams[ta][s.result.teams[ta].indexOf(a)] = b;
      s.result.teams[tb][s.result.teams[tb].indexOf(b)] = a;
      s.manualEdits = true;
    });
  }
  function restoreOriginal() {
    St.update(function (s) {
      if (!s.result || !s.result.original) return;
      s.result.teams = s.result.original.map(function (t) { return t.slice(); });
      s.manualEdits = false;
    });
    toast('편성 직후 상태로 복원했습니다.');
  }
  /* 미배정(늦게 온·복귀한) 학생을 기존 팀은 그대로 두고 가장 균형에 맞는 팀에 넣음: 인원 → 성별 → 목적함수 J 순 */
  function autoPlace(ids) {
    var placed = 0;
    St.update(function (s) {
      if (!s.result) return;
      keepOriginal(s);
      var prep = prepare(s), byId = {}; prep.forEach(function (p) { byId[p.id] = p; });
      var tau = Number(s.options.papsTolerance) || 3;
      var split = s.result.split || null;
      var K = Math.max(s.result.teams.length, split ? (split['남'] | 0) + (split['여'] | 0) : (s.options.teamCount | 0));
      while (s.result.teams.length < K) s.result.teams.push([]);
      ids.forEach(function (id) {
        var p = byId[id]; if (!p) return;
        var teams = s.result.teams, best = -1, bestKey = null;
        for (var t = 0; t < teams.length; t++) {
          /* 남녀 따로: 같은 성별 팀에만 */
          if (split && ((p.gender === '여' ? '여' : '남') === '남') !== (t < (split['남'] | 0))) continue;
          var trial = teams.map(function (x, i) { return i === t ? x.concat([id]) : x; });
          var st = split ? A.evaluateGroups(prep, trial, split).groups.find(function (g) { return g.idx.indexOf(t) >= 0; }).stats : A.evaluateTeams(prep, trial);
          var size = trial[t].filter(function (x) { return byId[x]; }).length;
          var tl = split ? (t < (split['남'] | 0) ? t : t - (split['남'] | 0)) : t;   // 그룹 안 팀 번호
          var gcnt = (s.options.genderBalance && !split && p.gender) ? (p.gender === '남' ? st.teams[tl].male : st.teams[tl].female) : 0;
          var J = 1000 * Math.max(0, st.Dp - tau) + st.Dc + 0.01 * st.Dp;
          var key = [size, gcnt, J];
          if (best < 0 || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2] - 1e-12)))) { best = t; bestKey = key; }
        }
        if (best >= 0) { teams[best].push(id); placed++; }
      });
      s.manualEdits = true;
    });
    toast(placed + '명을 기존 팀은 그대로 두고 균형에 맞춰 배치했습니다.');
  }

  /* ============================================================
   * 4. 결과
   * ============================================================ */
  var selectedMember = null;

  function renderResult(s, prep) {
    var byId = {}; prep.forEach(function (p) { byId[p.id] = p; });
    var summary = clear($('#result-summary')), log = clear($('#result-log')), un = clear($('#unassigned')),
        teamsEl = clear($('#teams')), bal = clear($('#balance')), charts = clear($('#charts')),
        absentEl = clear($('#result-absent')), checks = clear($('#result-checks'));
    $('#result-class').textContent = (s.classLabel ? s.classLabel + ' 학급' : '') + (s.result && s.result.builtAt ? ' · 편성 ' + X.localTime(s.result.builtAt, true) : '');
    $('#dnd-hint').textContent = '';
    /* 오늘 불참·역할 학생 (학생용 보기에도 표시 — 점수 없음) */
    var ina = St.inactiveStudents(s);
    if (ina.length) absentEl.appendChild(h('div', { class: 'absent' }, h('b', { text: '오늘 불참·역할 ' + ina.length + '명 ' }),
      ina.map(function (st) { return h('span', { class: 'badge', text: label(st) + ' · ' + (St.STATUS_LABEL[st.status] || st.status) }); }),
      h('span', { class: 'hint teacher-only', text: ' — 편성에서 제외. 2단계 명단에서 "참여"로 바꾸면 원래 팀으로 돌아옵니다.' })));
    var noteWrap = $('#result-note-wrap');
    var sr = sanitizeTeamsReport(s), teams = sr.teams;
    var remixBtn = $('#btn-remix'); if (remixBtn) remixBtn.hidden = !teams;
    if (!teams) {
      if (noteWrap) noteWrap.hidden = true;
      teamsEl.appendChild(h('div', { class: 'empty', text: s.studentView ? '아직 편성 결과가 없습니다.' : '3단계에서 편성 방식을 고르고 "편성 화면 열기"로 편성을 마치면 결과가 여기에 나타납니다.' }));
      return;
    }
    if (noteWrap) { noteWrap.hidden = false; setIfIdle($('#result-note'), (s.result && s.result.note) || ''); }
    var split = s.result.split || null;
    var ev = A.evaluateGroups(prep, teams, split);
    var stats = ev.groups[0].stats;   // 남녀 따로가 아니면 전체 통계
    var o = s.options;
    var unIds = unassignedIds(s, teams);

    /* 요약 */
    summary.className = 'result-summary';
    summary.appendChild(h('div', { class: 'equity', title: 'PAPS 팀 평균 범위와 4덕목 팀 평균 편차가 작을수록 높습니다 (0~100)' + (split ? '. 남녀 따로 편성은 성별 그룹별 점수의 인원 가중 평균' : '') },
      h('span', { class: 'score', text: ev.equity }), h('span', { class: 'label', html: '공정성<br>점수' })));
    summary.appendChild(h('div', { class: 'kv' },
      h('div', null, split ? ['남자 팀 ', h('b', { text: split['남'] }), '개 · 여자 팀 ', h('b', { text: split['여'] }), '개'] : ['팀 ', h('b', { text: teams.length }), '개'], ' · 학생 ', h('b', { text: prep.length }), '명',
        split ? h('span', { class: 'badge', text: '남녀 따로 편성' }) : null,
        s.manualEdits ? h('span', { class: 'badge warn', text: '수동 조정됨' }) : h('span', { class: 'badge ok', text: '시드 ' + s.result.seed }),
        s.result.source === 'draft' ? h('span', { class: 'badge', text: ({ auto: '교사 편성', pick: '팀별 드래프트', credit: '크레딧 드래프트' }[s.result.mode] || '드래프트') + ' 결과' }) : null,
        s.result.remix ? h('span', { class: 'badge', text: '🔀 새로운 조합', title: '지난 편성에서 같은 팀이었던 학생들이 덜 겹치게 다시 짠 편성' }) : null,
        (s.manualEdits && s.result.original && !s.studentView) ? h('button', { class: 'btn ghost small', type: 'button', style: 'margin-left:.4rem', title: '수동 조정을 모두 되돌려 편성 직후(추천안) 상태로', onclick: restoreOriginal }, '편성 직후로 복원') : null),
      split
        ? h('div', { class: 'teacher-only' }, ev.groups.map(function (g) { return h('span', { style: 'margin-right:.8rem' }, g.label + ' 공정성 ', h('b', { text: g.stats.equity }), h('span', { class: 'adv', text: ' (PAPS 범위 ' + fmt(g.stats.Dp, 1) + '점 · 인성 편차 ' + fmt(g.stats.Dc, 2) + ')' })); }))
        : h('div', { class: 'teacher-only adv' }, 'PAPS 팀 평균 범위 ', h('b', { text: fmt(stats.Dp, 1) }), '점 (허용 ' + Number(o.papsTolerance).toFixed(1) + '점, 100점 만점)',
          ' · 인성 편차 지수 ', h('b', { text: fmt(stats.Dc, 2) }), h('span', { class: 'hint', text: ' (4덕목 팀 평균 SD ÷ 학생 SD 합, 작을수록 균등)' })),
      h('div', null, (split ? '남녀 따로 편성 (같은 성별 안에서 균형)' : '성별 균형 ' + (o.genderBalance ? '켬' : '끔')) + ' · 팀 평균 PAPS 점수·4덕목이 서로 비슷할수록 공정한 편성입니다.'),
      (function () {
        var impP = prep.filter(function (p) { return p.papsImputed; }).length, impV = prep.filter(function (p) { return p.virtueImputed; }).length;
        return (impP || impV) ? h('div', { class: 'teacher-only' }, h('span', { class: 'badge warn', text: '대체' }), ' PAPS ' + impP + '명 · 인성 ' + impV + '명은 자료가 없어 학급 평균으로 채웠습니다. 그만큼 균형 수치가 실제보다 좋게 보일 수 있습니다.') : null;
      })()
    ));
    (s.result.log || []).forEach(function (m) { log.appendChild(h('div', { class: 'log adv', text: m })); });

    /* 편성 검사: 중복·미배정·인원/성별 균형·제약 조건 */
    (function () {
      var warns = [];
      if (sr.dups) warns.push('한 학생이 두 팀에 들어 있어 중복 ' + sr.dups + '건을 제거했습니다.');
      var sizes = teams.map(function (t) { return t.length; });
      var mn = Math.min.apply(null, sizes), mx = Math.max.apply(null, sizes);
      var absNote = ina.length ? ' 오늘 불참 ' + ina.length + '명을 뺀 결과일 수 있습니다 — 수업에 지장이 없으면 그대로 두고, 필요하면 학생을 끌어 옮기세요.' : '';
      if (split) {
        ev.groups.forEach(function (g) {
          var gs = g.teams.map(function (t) { return t.length; });
          var gmn = Math.min.apply(null, gs), gmx = Math.max.apply(null, gs);
          if (gs.length && gmx - gmn > 1) warns.push(g.label + ' 인원 차이가 ' + (gmx - gmn) + '명입니다 (최소 ' + gmn + ' · 최대 ' + gmx + ').' + absNote);
          g.teams.forEach(function (t, j) {
            var wrong = t.filter(function (id) { return byId[id] && (byId[id].gender === '여' ? '여' : '남') !== g.gender; });
            if (wrong.length) warns.push(teamName(g.idx[j]) + '(' + g.label + ')에 ' + (g.gender === '남' ? '여' : '남') + '학생이 들어 있습니다: ' + wrong.map(nm).join(', '));
          });
        });
      } else {
        if (sizes.length && mx - mn > 1) warns.push('팀 인원 차이가 ' + (mx - mn) + '명입니다 (최소 ' + mn + ' · 최대 ' + mx + ').' + absNote);
        if (o.genderBalance) ['남', '여'].forEach(function (g) {
          var c = stats.teams.map(function (tm) { return g === '남' ? tm.male : tm.female; });
          var d = Math.max.apply(null, c) - Math.min.apply(null, c);
          if (c.length && d > 1) warns.push('팀별 ' + g + '학생 수 차이가 ' + d + '명입니다.' + absNote);
        });
      }
      var teamOf = {}; teams.forEach(function (t, i) { t.forEach(function (id) { teamOf[id] = i; }); });
      var nm = function (id) { return byId[id] ? label(byId[id]) : id; };
      (o.together || []).forEach(function (pr) { if (teamOf[pr[0]] !== undefined && teamOf[pr[1]] !== undefined && teamOf[pr[0]] !== teamOf[pr[1]]) warns.push('함께 넣기 조건과 다릅니다: ' + nm(pr[0]) + ' + ' + nm(pr[1])); });
      (o.apart || []).forEach(function (pr) { if (teamOf[pr[0]] !== undefined && teamOf[pr[0]] === teamOf[pr[1]]) warns.push('떨어뜨리기 조건과 다릅니다: ' + nm(pr[0]) + ' ↔ ' + nm(pr[1]) + ' (' + teamName(teamOf[pr[0]]) + ')'); });
      Object.keys(o.pinned || {}).forEach(function (id) { if (teamOf[id] !== undefined && teamOf[id] !== +o.pinned[id]) warns.push('팀 고정과 다릅니다: ' + nm(id) + ' → ' + teamName(+o.pinned[id]) + '이어야 하는데 ' + teamName(teamOf[id]) + '에 있습니다.'); });
      if (unIds.length) warns.push('미배정 ' + unIds.length + '명이 있습니다. 아래에서 자동 배치하거나 팀 카드로 끌어다 놓으세요.');
      if (warns.length) warns.forEach(function (w) { checks.appendChild(h('div', { class: 'log', text: '⚠ ' + w })); });
      else checks.appendChild(h('div', { class: 'checks-ok', text: '✔ 검사 통과 — 중복·미배정 없음 · 팀 인원 균형' + (split ? ' · 남녀 팀 분리' : (o.genderBalance ? ' · 성별 균형' : '')) + ' · 제약 조건 충족' }));
    })();

    /* 미배정 (편성 뒤 추가·복귀한 학생) */
    if (unIds.length) {
      un.appendChild(h('div', { class: 'unassigned' }, h('b', { text: '미배정 ' + unIds.length + '명' }), h('span', { class: 'hint', text: ' — 편성 뒤 추가되거나 참여로 바뀐 학생입니다. ' }),
        s.studentView ? null : h('button', { class: 'btn small primary', type: 'button', title: '기존 팀은 그대로 두고, 인원·성별·균형 수치가 가장 좋아지는 팀에 넣습니다', onclick: function () { autoPlace(unIds); } }, '균형에 맞춰 자동 배치'),
        s.studentView ? null : h('span', { class: 'hint', text: ' 또는 팀 카드로 끌어다 놓으세요.' }),
        h('ul', { class: 'members' }, unIds.map(function (id) { return memberEl(byId[id], s, -1); }))));
    }

    /* 팀 카드 (번호순 — 체력 서열이 드러나지 않도록). 남녀 따로면 그룹 제목으로 구분 */
    var noOf = function (id) { var p = byId[id]; return p && p.no !== null && p.no !== undefined ? p.no : 1e9; };
    var statOf = {}; ev.groups.forEach(function (g) { g.idx.forEach(function (t, j) { statOf[t] = g.stats.teams[j]; }); });
    /* 남녀 따로: 그룹(남자 팀·여자 팀)마다 묶음을 만들어 나란히 배치. 묶음 폭은 팀 수에 비례, 모자라면 다음 줄로 */
    teamsEl.classList.toggle('split', !!split);
    /* 한 줄의 카드 수: 실제 폭에 들어가는 만큼, 줄이 나뉘면 줄마다 고르게 (6팀 → 5+1 이 아니라 3+3) */
    var gridW = teamsEl.clientWidth || 1150;
    var maxCols = Math.max(1, Math.floor((gridW + 13) / (230 + 13)));
    var balance = function (k) { var c = Math.max(1, Math.min(k, maxCols)); return Math.ceil(k / Math.ceil(k / c)); };
    teamsEl.style.setProperty('--cols', balance(teams.length));
    var rowOf = {};
    if (split) {
      var sideBySide = teams.length <= Math.max(1, Math.floor((gridW - 26 + 13) / (220 + 13)));   // 두 묶음을 나란히 놓을 수 있는가
      ev.groups.forEach(function (g) {
        var k = g.idx.length, row = h('div', { class: 'team-row', style: '--gcols:' + (sideBySide ? k : balance(k)) });
        teamsEl.appendChild(h('section', { class: 'team-group', style: 'flex:' + (sideBySide ? k + ' 1 0' : '1 1 100%') },
          h('h3', { class: 'group-title', text: (g.gender === '남' ? '👦 ' : '👧 ') + g.label + ' · ' + k + '팀 · ' + g.size + '명' }), row));
        g.idx.forEach(function (t) { rowOf[t] = row; });
      });
    }
    teams.forEach(function (rawIds, t) {
      var ids = rawIds.slice().sort(function (a, b) { return (isCaptain(s, b, t) - isCaptain(s, a, t)) || (noOf(a) - noOf(b)); });   // 주장이 맨 위, 나머지는 번호순
      var tm = statOf[t] || { size: ids.length, male: 0, female: 0, unknown: 0, meanPaps: NaN, meanVirtues: {} };
      var card = h('div', { class: 'team', dataset: { team: t } },
        h('div', { class: 'team-head', style: 'background:' + teamColor(t) },
          h('h3', { text: teamName(t) }), h('span', { class: 'meta', text: tm.size + '명 · 남 ' + tm.male + ' 여 ' + tm.female + (tm.unknown ? ' ?' + tm.unknown : '') })),
        h('div', { class: 'team-stats' },
          h('span', null, 'PAPS ', h('b', { text: fmt(tm.meanPaps, 1) + '점' })),
          VK.map(function (k) { return h('span', null, k + ' ', h('b', { text: fmt(tm.meanVirtues[k], 2) })); })),
        h('ul', { class: 'members' }, ids.map(function (id) { return memberEl(byId[id], s, t); }))
      );
      if (!s.studentView) {
        card.addEventListener('dragover', function (e) { e.preventDefault(); card.classList.add('over'); });
        card.addEventListener('dragleave', function () { card.classList.remove('over'); });
        card.addEventListener('drop', function (e) {
          e.preventDefault(); card.classList.remove('over');
          var id = e.dataTransfer.getData('text/plain');
          if (id && ids.indexOf(id) < 0) moveStudent(id, t);
        });
        card.addEventListener('click', function (e) {
          if (e.target.closest('.member')) return;
          if (selectedMember && ids.indexOf(selectedMember) < 0) { var id = selectedMember; selectedMember = null; moveStudent(id, t); }
        });
      }
      (rowOf[t] || teamsEl).appendChild(card);
    });
    if (!s.studentView) $('#dnd-hint').textContent = '학생을 다른 팀 카드로 끌어다 놓으면 이동하고, 학생을 클릭한 뒤 다른 학생을 클릭하면 서로 교환됩니다. 통계는 바로 다시 계산됩니다.';

    /* 균형표·차트 (남녀 따로면 성별 그룹마다 따로 — 팀 간 비교는 같은 성별 안에서) */
    bal.className = 'balance';
    ev.groups.forEach(function (g) {
      var gst = g.stats;
      var table = h('table');
      table.appendChild(h('thead', null, h('tr', null, h('th', { text: '팀' }), h('th', { text: '인원' }), h('th', { text: '남' }), h('th', { text: '여' }), h('th', { text: 'PAPS 평균(점/100)' }), VK.map(function (k) { return h('th', { text: k + '(/5)' }); }))));
      var tb = h('tbody');
      gst.teams.forEach(function (tm, j) {
        var t = g.idx[j];
        tb.appendChild(h('tr', null, h('td', { class: 'tn' }, h('i', { class: 'dot', style: 'background:' + teamColor(t) }), teamName(t)), h('td', { text: tm.size }), h('td', { text: tm.male }), h('td', { text: tm.female }),
          h('td', { text: fmt(tm.meanPaps, 1) }), VK.map(function (k) { return h('td', { text: fmt(tm.meanVirtues[k], 2) }); })));
      });
      tb.appendChild(h('tr', { class: 'foot adv' }, h('td', { class: 'tn', text: '범위(최대−최소)' }), h('td'), h('td'), h('td'), h('td', { text: fmt(gst.metrics.PAPS.range, 1) }), VK.map(function (k) { return h('td', { text: fmt(gst.metrics[k].range, 2) }); })));
      tb.appendChild(h('tr', { class: 'foot adv' }, h('td', { class: 'tn', text: '팀 평균 표준편차' }), h('td'), h('td'), h('td'), h('td', { text: fmt(gst.metrics.PAPS.sd, 1) }), VK.map(function (k) { return h('td', { text: fmt(gst.metrics[k].sd, 2) }); })));
      tb.appendChild(h('tr', { class: 'foot adv' }, h('td', { class: 'tn', text: '학생 표준편차(참고)' }), h('td'), h('td'), h('td'), h('td', { text: fmt(gst.metrics.PAPS.studentSd, 1) }), VK.map(function (k) { return h('td', { text: fmt(gst.metrics[k].studentSd, 2) }); })));
      var ratioCell = function (mk) {
        var m = gst.metrics[mk], r = m.studentSd > 1e-9 ? m.range / m.studentSd : Infinity, v = verdict(r);
        return h('td', null, h('span', { style: 'color:' + v.color + ';font-weight:700' }, v.text), h('span', { class: 'hint', text: ' ' + (isFinite(r) ? r.toFixed(2) + '배' : '') }));
      };
      tb.appendChild(h('tr', { class: 'foot' }, h('td', { class: 'tn', text: '균등 판정' }), h('td'), h('td'), h('td'), ratioCell('PAPS'), VK.map(ratioCell)));
      table.appendChild(tb);
      bal.appendChild(h('h3', { text: (split ? g.label + ' ' : '팀 ') + '균형표' + (split ? ' (' + g.label.replace(' 팀', '') + '학생 ' + g.students.length + '명 기준)' : '') }));
      bal.appendChild(table);

      /* 차트 */
      if (split) charts.appendChild(h('h3', { class: 'group-title', text: g.label + ' 차트' }));
      charts.appendChild(dotPlot(gst, g.students, o.papsTolerance, g.idx));
      charts.appendChild(radar(gst, g.students, g.idx));
    });
  }

  /* 드래프트에서 정한 팀 주장인가 (그 팀에 그대로 있을 때만) */
  function isCaptain(s, id, team) { return team >= 0 && !!(s.result && s.result.captains && s.result.captains[team] === id); }
  function memberEl(p, s, team) {
    if (!p) return null;
    var pinned = s.options.pinned && s.options.pinned[p.id] !== undefined;
    var cap = isCaptain(s, p.id, team);
    var el = h('li', { class: 'member' + (selectedMember === p.id ? ' selected' : '') + (cap ? ' captain' : ''), dataset: { id: p.id }, draggable: !s.studentView,
      title: (cap ? '팀 주장\n' : '') + (s.studentView ? '' : 'PAPS ' + fmt(p.papsPoints, 1) + '점 (' + p.papsGrade + '등급)' + (p.papsImputed ? ' (대체)' : '') + (p.papsDetail && p.papsDetail.overridden ? ' (교사 수정)' : '') + '\n' + VK.map(function (k) { return k + ' ' + fmt(p.virtues[k], 2); }).join(' · ') + (p.virtueImputed ? '\n(인성 일부 대체)' : '')) },
      h('span', { class: 'no', text: p.no === null || p.no === undefined ? '' : p.no }),
      h('span', { class: 'nm', text: p.name || '(이름 없음)' }),
      p.gender ? h('span', { class: 'g ' + (p.gender === '남' ? 'm' : 'f'), text: p.gender }) : null,
      cap ? h('span', { class: 'cap', title: '팀 주장', text: '👑 주장' }) : null,
      pinned ? h('span', { class: 'pin', title: '팀 고정', text: '📌' }) : null,
      h('span', { class: 'sc', text: fmt(p.papsPoints, 0) + '점 · ' + VK.map(function (k) { return fmt(p.virtues[k], 1); }).join('/') })
    );
    if (!s.studentView) {
      el.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; selectedMember = null; });
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        if (selectedMember === null) { selectedMember = p.id; el.classList.add('selected'); return; }
        if (selectedMember === p.id) { selectedMember = null; el.classList.remove('selected'); return; }
        var a = selectedMember; selectedMember = null;
        if (team < 0) { moveStudent(a, 0); return; }
        var teams = sanitizeTeams(St.get());
        var ta = -1; teams.forEach(function (t, i) { if (t.indexOf(a) >= 0) ta = i; });
        if (ta < 0) moveStudent(a, team); else swapStudents(a, p.id);
      });
    }
    return el;
  }

  /* ---------- 균등 판정 (팀 평균 범위 ÷ 학생 표준편차) ---------- */
  var D2 = { 2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078, 11: 3.173, 12: 3.258 }; // K개 정규 표본의 기대 범위
  function verdict(ratio) {
    if (!isFinite(ratio)) return { text: '–', color: '#8a97a8' };
    if (ratio <= 0.25) return { text: '매우 균등', color: '#1e8e5a' };
    if (ratio <= 0.5) return { text: '균등', color: '#2e86de' };
    if (ratio <= 1.0) return { text: '보통', color: '#b7791f' };
    return { text: '차이 큼', color: '#c0392b' };
  }
  function metricValues(prep, mk) { return prep.map(function (p) { return mk === 'PAPS' ? p.papsPoints : p.virtues[mk]; }); }
  /* 무작위로 나눴을 때 기대되는 팀 평균의 최대−최소 범위 */
  function randomExpectedRange(sd, K, N) {
    var n = Math.max(1, N / Math.max(1, K));
    return sd / Math.sqrt(n) * (D2[Math.min(12, Math.max(2, K))] || 2.5);
  }

  /* ---------- 차트: 지표별 팀 평균 분포 (학생 분포 축 고정) ---------- */
  /* idx: 그룹 안 팀 순번 → 전체 팀 번호 (남녀 따로일 때 색·이름용) */
  function dotPlot(stats, prep, tau, idx) {
    var gi = function (t) { return idx ? idx[t] : t; };
    var metrics = ['PAPS'].concat(VK);
    var W = 700, rowH = 60, labelW = 72, right = 160, top = 14;
    var H = top + metrics.length * rowH + 8;
    var K = stats.teams.length, N = prep.length;
    var root_ = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '지표별 팀 평균 분포' });
    metrics.forEach(function (mk, i) {
      var m = stats.metrics[mk], tm = m.teamMeans, sd = m.studentSd || 0;
      var vals = metricValues(prep, mk);
      var mean = vals.reduce(function (a, b) { return a + b; }, 0) / (vals.length || 1);
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
      var pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
      var y = top + i * rowH + 28;
      var x0 = labelW, x1 = W - right;
      var xOf = function (v) { return x0 + (v - lo) / (hi - lo) * (x1 - x0); };
      var dec = mk === 'PAPS' ? 1 : 2;
      var half = mk === 'PAPS' ? (tau || 4) / 2 : 0.25 * sd;   // 균등 기준 띠 (학급 평균 ±)
      var rr = randomExpectedRange(sd, K, N);                    // 무작위 예상 범위
      var ratio = sd > 1e-9 ? m.range / sd : Infinity;
      var vd = verdict(ratio);

      root_.appendChild(svg('text', { x: 6, y: y + 4, 'font-size': 13, 'font-weight': 700, fill: '#1b2430' }, mk === 'PAPS' ? 'PAPS' : mk));
      /* 균등 띠 */
      root_.appendChild(svg('rect', { x: xOf(mean - half), y: y - 13, width: Math.max(2, xOf(mean + half) - xOf(mean - half)), height: 26, rx: 5, fill: '#1e8e5a', 'fill-opacity': 0.13 }));
      /* 축 + 양끝 값 */
      root_.appendChild(svg('line', { x1: x0, x2: x1, y1: y, y2: y, stroke: '#d5dce8', 'stroke-width': 2 }));
      root_.appendChild(svg('text', { x: x0, y: y + 23, 'font-size': 9, fill: '#8a97a8', 'text-anchor': 'start' }, (lo + pad).toFixed(dec)));
      root_.appendChild(svg('text', { x: x1, y: y + 23, 'font-size': 9, fill: '#8a97a8', 'text-anchor': 'end' }, (hi - pad).toFixed(dec)));
      /* 학생 개개인 (회색) */
      vals.forEach(function (v, j) {
        root_.appendChild(svg('circle', { cx: xOf(v), cy: y + ((j % 3) - 1) * 3.5, r: 2.4, fill: '#64748b', 'fill-opacity': 0.35 }));
      });
      /* 학급 평균 */
      root_.appendChild(svg('line', { x1: xOf(mean), x2: xOf(mean), y1: y - 16, y2: y + 16, stroke: '#1e8e5a', 'stroke-width': 1.5, 'stroke-dasharray': '3 2' }));
      root_.appendChild(svg('text', { x: xOf(mean), y: y - 19, 'font-size': 9, fill: '#1e8e5a', 'text-anchor': 'middle' }, '학급 평균 ' + mean.toFixed(dec)));
      /* 무작위 예상 범위 (점선 괄호) */
      var rx0 = xOf(mean - rr / 2), rx1 = xOf(mean + rr / 2), ry = y + 16;
      root_.appendChild(svg('line', { x1: rx0, x2: rx1, y1: ry, y2: ry, stroke: '#b7791f', 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }));
      root_.appendChild(svg('line', { x1: rx0, x2: rx0, y1: ry - 3, y2: ry + 3, stroke: '#b7791f' }));
      root_.appendChild(svg('line', { x1: rx1, x2: rx1, y1: ry - 3, y2: ry + 3, stroke: '#b7791f' }));
      /* 팀 평균 */
      tm.forEach(function (v, t) {
        var c = svg('circle', { cx: xOf(v), cy: y, r: 6.5, fill: teamColor(gi(t)), stroke: '#fff', 'stroke-width': 1.5 });
        c.appendChild(svg('title', null, teamName(gi(t)) + ' ' + mk + ' 평균 ' + v.toFixed(dec) + ' (학급 평균과의 차이 ' + (v - mean >= 0 ? '+' : '') + (v - mean).toFixed(dec) + ')'));
        root_.appendChild(c);
      });
      /* 오른쪽: 수치 + 판정 */
      root_.appendChild(svg('text', { x: W - 6, y: y - 4, 'font-size': 10.5, fill: '#5d6b7c', 'text-anchor': 'end' },
        '범위 ' + m.range.toFixed(dec) + (mk === 'PAPS' ? '점' : '') + ' · 학생 편차의 ' + (isFinite(ratio) ? ratio.toFixed(2) : '–') + '배'));
      var pw = vd.text.length * 11 + 14;
      root_.appendChild(svg('rect', { x: W - 6 - pw, y: y + 3, width: pw, height: 16, rx: 8, fill: vd.color, 'fill-opacity': 0.14 }));
      root_.appendChild(svg('text', { x: W - 6 - pw / 2, y: y + 15, 'font-size': 10.5, 'font-weight': 700, fill: vd.color, 'text-anchor': 'middle' }, vd.text));
    });
    var box = h('div', { class: 'chart' }, h('h4', { text: '지표별 팀 평균 분포 (팀 점이 초록 띠 안에 모일수록 균등)' }), root_,
      h('div', { class: 'legend' }, stats.teams.map(function (_, t) { return h('span', null, h('i', { style: 'background:' + teamColor(gi(t)) }), teamName(gi(t))); })),
      h('div', { class: 'legend' },
        h('span', null, h('i', { style: 'background:#64748b;opacity:.5' }), '학생 개개인'),
        h('span', null, h('i', { style: 'background:#1e8e5a;opacity:.35;border-radius:3px' }), '균등 기준 띠 = 학급 평균 ± 학생 편차 0.25배 (PAPS는 허용편차)'),
        h('span', null, h('i', { style: 'background:none;border-top:2px dashed #b7791f;border-radius:0;height:0;width:1.2em' }), '무작위로 나눌 때 예상되는 팀 평균 범위'),
        h('span', { text: '판정: 범위가 학생 편차의 0.25배 이하 매우 균등 · 0.5배 이하 균등 · 1배 이하 보통 · 그 이상 차이 큼' })));
    return box;
  }

  /* ---------- 차트: 4덕목 레이더 (학급 평균 중심, 학생 표준편차 단위 고정 축) ---------- */
  function radar(stats, prep, idx) {
    var gi = function (t) { return idx ? idx[t] : t; };
    var size = 320, cx = size / 2, cy = size / 2 + 6, R = 112, ZMAX = 1.5;
    var means = {}, sds = {};
    VK.forEach(function (k) { var v = metricValues(prep, k); means[k] = v.reduce(function (a, b) { return a + b; }, 0) / (v.length || 1); sds[k] = stats.metrics[k].studentSd || 1e-9; });
    var root_ = svg('svg', { viewBox: '0 0 ' + size + ' ' + (size + 10), role: 'img', 'aria-label': '4덕목 팀 평균 레이더' });
    var ang = function (i) { return -Math.PI / 2 + i * Math.PI / 2; };
    var zOf = function (k, v) { return Math.max(-ZMAX, Math.min(ZMAX, (v - means[k]) / sds[k])); };
    var ptZ = function (i, z) { var r = R * (z + ZMAX) / (2 * ZMAX); return [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))]; };
    var ring = function (z) { return VK.map(function (_, i) { return ptZ(i, z).join(','); }).join(' '); };
    /* 균등 영역: 학급 평균 ± 0.25 SD */
    root_.appendChild(svg('polygon', { points: ring(0.25), fill: '#1e8e5a', 'fill-opacity': 0.14, stroke: 'none' }));
    root_.appendChild(svg('polygon', { points: ring(-0.25), fill: '#ffffff', 'fill-opacity': 0.9, stroke: 'none' }));
    [-1, -0.5, 0.5, 1, ZMAX].forEach(function (z) { root_.appendChild(svg('polygon', { points: ring(z), fill: 'none', stroke: '#e3e8f0' })); });
    root_.appendChild(svg('polygon', { points: ring(0), fill: 'none', stroke: '#1e8e5a', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
    [[0, '학급 평균'], [1, '+1 SD'], [-1, '−1 SD']].forEach(function (lbl) {
      root_.appendChild(svg('text', { x: cx + 5, y: ptZ(0, lbl[0])[1] - 2, 'font-size': 9, fill: lbl[0] === 0 ? '#1e8e5a' : '#8a97a8' }, lbl[1]));
    });
    VK.forEach(function (k, i) {
      var p = ptZ(i, ZMAX);
      root_.appendChild(svg('line', { x1: cx, y1: cy, x2: p[0], y2: p[1], stroke: '#dde3ec' }));
      var lx = cx + (R + 20) * Math.cos(ang(i)), ly = cy + (R + 20) * Math.sin(ang(i));
      root_.appendChild(svg('text', { x: lx, y: ly + 4, 'font-size': 12, 'font-weight': 600, fill: '#1b2430', 'text-anchor': 'middle' }, k));
    });
    stats.teams.forEach(function (tm, t) {
      var pts = VK.map(function (k, i) { return ptZ(i, zOf(k, tm.meanVirtues[k])).join(','); }).join(' ');
      var poly = svg('polygon', { points: pts, fill: teamColor(gi(t)), 'fill-opacity': 0.06, stroke: teamColor(gi(t)), 'stroke-width': 2 });
      poly.appendChild(svg('title', null, teamName(gi(t)) + ' ' + VK.map(function (k) { return k + ' ' + tm.meanVirtues[k].toFixed(2) + ' (' + (zOf(k, tm.meanVirtues[k]) >= 0 ? '+' : '') + zOf(k, tm.meanVirtues[k]).toFixed(2) + ' SD)'; }).join(', ')));
      root_.appendChild(poly);
    });
    return h('div', { class: 'chart' }, h('h4', { text: '4덕목 팀 평균 레이더 (초록 점선 = 학급 평균, 띠 안이면 균등)' }), root_,
      h('div', { class: 'legend' }, h('span', { text: '축은 학급 평균을 중심으로 학생 표준편차(SD) 단위로 고정되어, 학급이 달라도 같은 모양이면 같은 뜻입니다.' })));
  }

  /* ============================================================
   * 5. 내보내기·상단
   * ============================================================ */
  function bindExportEvents() {
    function doXlsx(includeScores) {
      var s = St.get();
      var teams = sanitizeTeams(s);
      if (!teams) { toast('먼저 팀을 편성하세요.', true); return; }
      var prep = prepare(s);
      var ev = A.evaluateGroups(prep, teams, s.result.split || null);
      try { var f = X.exportTeamsXlsx(s, prep, teams, ev.groups[0].stats, { includeScores: includeScores, teamNames: s.teamNames, groups: ev.groups, split: s.result.split || null, equity: ev.equity }); toast(f + ' 저장'); }
      catch (e) { toast(e.message, true); }
    }
    $('#btn-xlsx').addEventListener('click', function () { doXlsx(false); });
    $('#btn-xlsx-teacher').addEventListener('click', function () { doXlsx(true); });
    $('#btn-xlsx-all').addEventListener('click', function () {
      var s = St.get();
      /* 현재 학급도 이름이 있으면 저장본을 갱신해 함께 포함 */
      if (s.classLabel && s.students.length) St.putSaved(s.classLabel, s);
      try { var r = X.exportAllClassesXlsx(St.listSaved()); toast(r.fname + ' 저장 — ' + r.count + '개 학급' + (r.skipped.length ? ' (편성 결과 없는 학급 제외: ' + r.skipped.join(', ') + ')' : '')); }
      catch (e) { toast(e.message, true); }
      render();
    });
    $('#result-note').addEventListener('change', function (e) { St.update(function (s) { if (s.result) s.result.note = e.target.value; }, { noUndo: true }); });
    $('#btn-json').addEventListener('click', function () { toast(X.exportSessionJSON(St.get()) + ' 저장'); });
    $('#json-input').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { try { St.importJSON(r.result); toast('세션을 불러왔습니다.'); } catch (err) { toast(err.message, true); } };
      r.readAsText(f, 'utf-8'); e.target.value = '';
    });
    $$('.btn-template').forEach(function (b) { b.addEventListener('click', function () { try { X.exportTemplateXlsx(b.dataset.kind); } catch (e) { toast(e.message, true); } }); });
    /* 인쇄 버튼(4단계 '인쇄', 5단계 인쇄물 버튼들)은 print.js 가 미리보기를 열어 처리 */
    var remixBtn = $('#btn-remix'); if (remixBtn) remixBtn.addEventListener('click', remix);
  }

  /* 간단/자세히 보기 (브라우저별 설정) */
  var UI_DETAIL_KEY = 'agora.ui.detail';
  function isDetail() { try { return localStorage.getItem(UI_DETAIL_KEY) === '1'; } catch (e) { return false; } }
  function setDetail(on) { try { localStorage.setItem(UI_DETAIL_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ } }

  function renderTop(s) {
    setIfIdle($('#class-label'), s.classLabel || '');
    $('#student-view-toggle').checked = !!s.studentView;
    document.body.classList.toggle('student-view', !!s.studentView);
    $('#detail-toggle').checked = isDetail();
    document.body.classList.toggle('simple', !isDetail());
    /* 학급 전환 선택: 저장된 학급 + 현재 학급 */
    var sel = $('#saved-select');
    clear(sel);
    var saved = St.listSaved(), curLbl = s.classLabel || '', hasCur = false;
    sel.appendChild(h('option', { value: '', text: saved.length ? '학급 전환…' : '저장된 학급 없음' }));
    saved.forEach(function (e) {
      if (e.label === curLbl) hasCur = true;
      var ss = e.session || {};
      sel.appendChild(h('option', { value: e.label, text: e.label + ' (' + (ss.students || []).length + '명' + (ss.result ? ' · 편성됨' : '') + ')' }));
    });
    if (curLbl && !hasCur) sel.appendChild(h('option', { value: curLbl, text: curLbl + ' (현재 · 저장 안 됨)' }));
    sel.value = curLbl && Array.prototype.some.call(sel.options, function (o) { return o.value === curLbl; }) ? curLbl : '';
    sel.title = '저장된 학급으로 전환합니다. 현재 학급은 이름이 있으면 자동으로 저장됩니다.';
    var del = $('#btn-del-class'); if (del) del.disabled = !(curLbl && hasCur);
    var ord = $('#btn-order-class'); if (ord) ord.disabled = saved.length + (curLbl && !hasCur && s.students.length ? 1 : 0) < 2;   // 학급이 둘 이상일 때만
    $('#btn-undo').disabled = !St.canUndo();
  }
  function bindTopEvents() {
    $('#class-label').addEventListener('change', function (e) {
      var v = e.target.value.trim();
      St.update(function (s) {
        s.classLabel = v;
        var pc = P.parseClass(v);
        if (pc && pc.cls) s.classInfo = { grade: pc.grade, cls: pc.cls };   // "1-3" 처럼 적으면 그 반 자료만 들어오도록
      }, { noUndo: true });
    });
    $('#student-view-toggle').addEventListener('change', function (e) { selectedMember = null; St.update(function (s) { s.studentView = e.target.checked; }, { noUndo: true }); });
    $('#detail-toggle').addEventListener('change', function (e) { setDetail(e.target.checked); render(); });
    $('#btn-save-class').addEventListener('click', function () {
      var lbl = $('#class-label').value.trim() || prompt('학급 이름을 입력하세요 (예: 1-3)');
      if (!lbl) return;
      St.saveAs(lbl); toast('"' + lbl + '" 학급으로 저장했습니다.');
    });
    $('#saved-select').addEventListener('change', function (e) {
      var lbl = e.target.value;
      if (!lbl || lbl === St.get().classLabel) return;
      switchClass(lbl);
    });
    $('#btn-new-class').addEventListener('click', addNewClass);
    $('#btn-order-class').addEventListener('click', openOrderDialog);
    $('#btn-order-close').addEventListener('click', closeOrderDialog);
    $('#btn-order-sort').addEventListener('click', function () { St.sortSaved(); afterOrderChange(); toast('이름순으로 정렬했습니다.'); });
    $('#class-order').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeOrderDialog(); });   // 바깥(배경) 클릭으로 닫기
    var delBtn = $('#btn-del-class');
    if (delBtn) delBtn.addEventListener('click', function () {
      var lbl = St.get().classLabel;
      if (lbl && confirm('"' + lbl + '" 학급 저장본을 삭제할까요? (현재 화면의 자료는 그대로 남습니다)')) { St.deleteSaved(lbl); render(); toast('저장본을 삭제했습니다.'); }
    });
    $('#btn-undo').addEventListener('click', function () { if (!St.undo()) toast('되돌릴 작업이 없습니다.'); });
    $('#btn-reset').addEventListener('click', function () {
      if (confirm('현재 자료·설정·결과를 모두 지우고 새로 시작할까요? (되돌리기 가능)')) { pending = { paps: null, survey: null }; clear($('#map-paps')); clear($('#map-survey')); St.reset(); }
    });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); St.undo(); }
      if (e.key === 'Escape' && selectedMember) { selectedMember = null; $$('.member.selected').forEach(function (el) { el.classList.remove('selected'); }); }
    });
  }

  /* ============================================================ */
  function render() {
    var s = St.get();
    var prep = prepare(s);                                                                   // 참여 학생 (편성 대상)
    var prepAll = St.inactiveStudents(s).length ? S.prepareStudents(s.students, s.options) : prep; // 명단 표시용 (불참 포함)
    renderTop(s);
    renderImportStatus(s);
    renderRoster(s, prepAll);
    renderSettings(s, prep);
    renderResult(s, prep);
  }

  function init() {
    bindTopEvents(); bindImportEvents(); bindRosterEvents(); bindSettingsEvents(); bindExportEvents();
    St.onChange(render);
    render();
    /* 창 폭이 바뀌면 카드 줄 나눔을 다시 계산 (휴대폰의 주소창 높이 변화는 무시) */
    var lastW = window.innerWidth, rt = null;
    window.addEventListener('resize', function () {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth; clearTimeout(rt);
      rt = setTimeout(function () { if (!/input|textarea|select/i.test((document.activeElement || {}).tagName || '')) render(); }, 200);
    });
    if (!root.XLSX) toast('엑셀 라이브러리를 불러오지 못했습니다. xlsx 파일 대신 CSV/붙여넣기를 사용하세요.', true);
  }

  root.AgoraUI = { init: init, render: render, build: build, loadFile: loadRowsFromFile };
})(window);
