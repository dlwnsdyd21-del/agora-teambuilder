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
  function teamName(t) { var s = St.get(); return (s.teamNames && s.teamNames[t]) || ((t + 1) + '팀'); }
  function label(s) { return (s.no !== null && s.no !== undefined ? s.no + ' ' : '') + (s.name || '(이름 없음)'); }
  function keyOf(r) {
    if (r.no !== null && r.no !== undefined && r.no !== '') return 'n' + r.no;
    if (r.name) return 'm' + String(r.name).replace(/\s/g, '').toLowerCase();
    return null;
  }

  /* ---------- 파생 데이터 ---------- */
  function prepare(session) { return S.prepareStudents(session.students, session.options); }
  function sanitizeTeams(session) {
    if (!session.result || !Array.isArray(session.result.teams)) return null;
    var ids = {}; session.students.forEach(function (s) { ids[s.id] = true; });
    var seen = {};
    return session.result.teams.map(function (t) {
      return t.filter(function (id) { if (!ids[id] || seen[id]) return false; seen[id] = true; return true; });
    });
  }
  function unassignedIds(session, teams) {
    var inTeam = {};
    (teams || []).forEach(function (t) { t.forEach(function (id) { inTeam[id] = true; }); });
    return session.students.filter(function (s) { return !inTeam[s.id]; }).map(function (s) { return s.id; });
  }

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
    pending[kind] = { fileName: fileName, sheets: sheets, sheetIndex: bestIdx, det: P.detectTable(sheets[bestIdx].rows) };
    /* 확실하면 확인 없이 바로 반영 */
    if (sheets.length === 1 && isConfident(pending[kind].det)) {
      lastImport[kind] = pending[kind];
      if (applyPending(kind, true)) {
        var roster = $('#sec-roster');
        if (roster) roster.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
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
    /* 인식 요약 + 적용 버튼을 먼저, 세부 매핑은 접어 둠 */
    var found = [];
    if (m.no !== undefined) found.push('번호'); if (m.hakbun !== undefined) found.push('학번'); if (m.name !== undefined) found.push('이름'); if (m.gender !== undefined) found.push('성별');
    if (det.meta && det.meta.neis) found.push('나이스 영역 점수'); else if (m.run !== undefined || m.flex1 !== undefined) found.push('PAPS 원기록');
    if (m.papsGiven !== undefined) found.push('PAPS 총점');
    if (m.itemCount) found.push('인성 ' + m.itemCount + '문항'); if (m['v_성실'] !== undefined) found.push('4덕목');
    var recCount = P.extractStudents(rows, det).length;
    wrap.appendChild(h('div', { class: 'row wrap', style: 'margin:.5rem 0' },
      h('span', { class: 'hint', text: '인식된 열: ' + (found.join(' · ') || '없음') + ' · 학생 ' + recCount + '명' }),
      h('button', { class: 'btn primary', type: 'button', onclick: function () { applyPending(kind); } }, '이 자료 반영'),
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

  /* quiet: 자동 반영 시 실패해도 토스트 대신 false 반환 */
  function applyPending(kind, quiet) {
    var pd = pending[kind];
    if (!pd) return false;
    var sheet = pd.sheets[pd.sheetIndex];
    var det = pd.det;
    det.mapping.itemCount = det.mapping.items.filter(function (c) { return c >= 0; }).length;
    if (det.mapping.no === undefined && det.mapping.name === undefined && det.mapping.hakbun === undefined) { if (!quiet) toast('번호, 학번 또는 이름 열을 지정해 주세요.', true); return false; }
    var recs = P.extractStudents(sheet.rows, det);
    if (!recs.length) { if (!quiet) toast('학생 행을 찾지 못했습니다. 헤더 행과 번호/이름 열을 확인하세요.', true); return false; }
    var hasData = recs.some(function (r) { return r.papsRaw || r.papsGiven !== null || r.items || r.virtuesGiven; });
    if (!hasData) { if (!quiet) toast('점수 열(PAPS 원기록/총점 또는 32문항/4덕목)을 지정해 주세요.', true); return false; }
    applyImport(kind, recs, { fileName: pd.fileName, sheetName: sheet.name, papsGivenType: det.mapping.papsGivenType, neis: det.meta && det.meta.neis });
    lastImport[kind] = pd;
    pending[kind] = null;
    clear($('#map-' + kind));
    var msg = recs.length + '명의 자료를 반영했습니다.';
    if (det.meta && det.meta.neis) {
      var s = St.get();
      var inf = S.inferFromNeis(s.students, s.options);
      if (inf.inferred) {
        var applied = 0;
        St.update(function (ss) {
          ss.students.forEach(function (st) {
            var r = inf.byId[st.id];
            if (r && !st.gender) { st.gender = r.gender; st.genderInferred = true; applied++; }
          });
          if (inf.gradeKey && inf.gradeKeyShare >= 0.8) {
            ss.options.schoolLevel = inf.gradeKey.charAt(0);
            ss.options.defaultGrade = parseInt(inf.gradeKey.slice(1), 10) || ss.options.defaultGrade;
          }
        }, { noUndo: true });
        msg += ' 나이스 점수로 기준표를 대조해 ' + (inf.gradeKeyShare >= 0.8 ? inf.gradeKey + ' 기준표, ' : '') + '성별 ' + applied + '명(남 ' + inf.counts['남'] + ' 여 ' + inf.counts['여'] + ')을 추정했습니다. 명단에서 확인하세요.';
      }
    }
    toast(msg);
    return true;
  }

  function applyImport(kind, recs, meta) {
    St.update(function (s) {
      var byKey = {};
      s.students.forEach(function (st) { var k = keyOf(st); if (k) byKey[k] = st; });
      var added = 0;
      recs.forEach(function (r) {
        var k = keyOf(r);
        var st = k ? byKey[k] : null;
        if (!st) {
          st = { id: k || ('u' + Date.now() + Math.floor(Math.random() * 1e6)), no: r.no === undefined ? null : r.no, name: r.name || null, gender: null,
                 papsRaw: null, papsGiven: null, items: null, virtuesGiven: null, source: { paps: false, survey: false } };
          s.students.push(st); if (k) byKey[k] = st; added++;
        }
        if (!st.source) st.source = { paps: false, survey: false };
        if (!st.name && r.name) st.name = r.name;
        if (r.gender) { st.gender = r.gender; st.genderInferred = false; }
        if (r.grade && !st.grade) st.grade = r.grade;
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
      s.imports[kind] = { fileName: meta.fileName, sheetName: meta.sheetName, rowCount: recs.length, added: added, at: new Date().toISOString() };
      if (meta.papsGivenType) s.options.papsGivenType = meta.papsGivenType;
    });
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
        var line = h('div', { class: 'ok' }, '✔ ' + im.fileName + (im.sheetName && im.sheetName !== 'CSV' && im.sheetName !== 'sheet1' ? ' / ' + im.sheetName : '') + ' · ' + im.rowCount + '명 반영 (현재 ' + cnt + '명)');
        if (lastImport[kind] && lastImport[kind].fileName === im.fileName) {
          line.appendChild(h('button', { class: 'btn ghost small', type: 'button', style: 'margin-left:.5rem', title: '열 인식이 잘못됐다면 직접 고쳐 다시 반영', onclick: function () { pending[kind] = lastImport[kind]; renderMapping(kind); } }, '열 매핑 수정'));
        }
        el.appendChild(line);
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
      var tr = h('tr', { dataset: { id: st.id } });
      tr.appendChild(h('td', null, h('input', { type: 'number', min: 1, 'data-field': 'no', value: st.no === null || st.no === undefined ? '' : st.no })));
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
        papsTd.appendChild(h('span', { title: srcText + '\n' + lines + scaledText }, fmt(p.papsPoints, 1) + '점'));
        papsTd.appendChild(h('span', { class: 'badge', text: p.papsGrade + '등급' }));
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
      /* 상태 */
      var stTd = h('td');
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
    $('#roster-summary').textContent = s.students.length ? ('총 ' + s.students.length + '명 · 남 ' + m + ' 여 ' + f + (u ? ' 미상 ' + u : '') + ' · PAPS ' + hasP + '명' + (rel ? ' (상대점수 ' + rel + '명)' : '') + ' · 인성 ' + hasV + '명') : '';
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
        else if (field === 'papsGiven') st.papsGiven = S.toNum(val);
        else if (field.slice(0, 2) === 'v_') { st.virtuesGiven = st.virtuesGiven || {}; st.virtuesGiven[field.slice(2)] = S.toNum(val); if (VK.every(function (k) { return st.virtuesGiven[k] === null || st.virtuesGiven[k] === undefined; })) st.virtuesGiven = null; }
        if (field === 'no' || field === 'name') sortStudents(s.students);
      });
    });
    $('#roster-body').addEventListener('click', function (e) {
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
    setIfIdle($('#opt-seed'), o.seed);
    $$('input[name=draftMode]').forEach(function (r) { r.checked = (o.draftMode || 'auto') === r.value; });
    var N = s.students.length, K = Math.max(1, o.teamCount | 0);
    $('#team-size-hint').textContent = N ? ('학생 ' + N + '명 → 팀당 ' + Math.floor(N / K) + (N % K ? '~' + Math.ceil(N / K) : '') + '명') : '';
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
    $('#opt-papsTolerance').addEventListener('input', function (e) { $('#tau-value').textContent = Number(e.target.value).toFixed(1); });
    $('#opt-papsTolerance').addEventListener('change', upd('papsTolerance', function (el) { return parseFloat(el.value); }));
    $('#opt-includeBmi').addEventListener('change', upd('includeBmi', function (el) { return el.checked; }));
    $('#opt-schoolLevel').addEventListener('change', upd('schoolLevel'));
    $('#opt-defaultGrade').addEventListener('change', upd('defaultGrade', function (el) { var v = parseInt(el.value, 10); return isNaN(v) || v < 1 ? 1 : Math.min(6, v); }));
    $('#opt-papsGivenType').addEventListener('change', upd('papsGivenType'));
    $('#opt-seed').addEventListener('change', upd('seed', function (el) { var v = parseInt(el.value, 10); return isNaN(v) || v < 1 ? 1 : v; }));
    $$('input[name=draftMode]').forEach(function (r) { r.addEventListener('change', function () { if (r.checked) St.update(function (s) { s.options.draftMode = r.value; }, { noUndo: true }); }); });
    $('#btn-draft').addEventListener('click', function () { St.persistNow(); });
    /* 드래프트 화면(다른 탭)에서 저장하면 즉시 반영 */
    window.addEventListener('storage', function (e) { if (e.key === St.KEY) { St.load(); render(); } });
    $('#btn-build').addEventListener('click', function () { build(); });
    $('#btn-reshuffle').addEventListener('click', function () { reshuffle(); });
    $('#btn-reshuffle2').addEventListener('click', function () { reshuffle(); });
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
    var selT = h('select', null, Array.from({ length: Math.max(1, o.teamCount | 0) }, function (_, t) { return h('option', { value: t, text: teamName(t) }); }));
    var addP = h('button', { class: 'btn small', type: 'button', onclick: function () {
      if (!selS.value) { toast('학생을 고르세요.', true); return; }
      St.update(function (ss) { ss.options.pinned = ss.options.pinned || {}; ss.options.pinned[selS.value] = +selT.value; });
    } }, '추가');
    grid.appendChild(h('div', { class: 'cons-box' }, h('h4', { text: '팀 고정' }), ul, h('div', { class: 'row' }, selS, selT, addP)));
    box.appendChild(grid);
  }

  /* ============================================================
   * 편성 실행
   * ============================================================ */
  function build(seed) {
    var s = St.get();
    if (!s.students.length) { toast('먼저 학생 자료를 불러오세요.', true); return; }
    var prep = prepare(s);
    var opt = Object.assign({}, s.options, { seed: seed === undefined ? s.options.seed : seed });
    var t0 = Date.now();
    var res = A.buildTeams(prep, opt);
    St.update(function (ss) {
      ss.options.seed = opt.seed;
      ss.result = { teams: res.teams, seed: res.seed, log: res.log, builtAt: new Date().toISOString(), meta: res.meta };
      ss.manualEdits = false;
    });
    toast('팀 편성 완료 (공정성 ' + res.equity + '점, ' + (Date.now() - t0) + 'ms)');
    var sec = $('#sec-result'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function reshuffle() {
    var s = St.get();
    if (!s.students.length) { toast('먼저 학생 자료를 불러오세요.', true); return; }
    build((s.options.seed | 0) + 1);
  }
  function moveStudent(id, toTeam) {
    St.update(function (s) {
      if (!s.result) return;
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
      s.result.teams[ta][s.result.teams[ta].indexOf(a)] = b;
      s.result.teams[tb][s.result.teams[tb].indexOf(b)] = a;
      s.manualEdits = true;
    });
  }

  /* ============================================================
   * 4. 결과
   * ============================================================ */
  var selectedMember = null;

  function renderResult(s, prep) {
    var byId = {}; prep.forEach(function (p) { byId[p.id] = p; });
    var summary = clear($('#result-summary')), log = clear($('#result-log')), un = clear($('#unassigned')),
        teamsEl = clear($('#teams')), bal = clear($('#balance')), charts = clear($('#charts'));
    $('#result-class').textContent = s.classLabel ? s.classLabel + ' 학급' : '';
    $('#dnd-hint').textContent = '';
    var teams = sanitizeTeams(s);
    if (!teams) {
      teamsEl.appendChild(h('div', { class: 'empty', text: s.studentView ? '아직 편성 결과가 없습니다.' : '3단계에서 "팀 편성하기"를 누르면 결과가 여기에 나타납니다.' }));
      return;
    }
    var stats = A.evaluateTeams(prep, teams);
    var o = s.options;

    /* 요약 */
    summary.className = 'result-summary';
    summary.appendChild(h('div', { class: 'equity', title: 'PAPS 팀 평균 범위와 4덕목 팀 평균 편차가 작을수록 높습니다 (0~100)' },
      h('span', { class: 'score', text: stats.equity }), h('span', { class: 'label', html: '공정성<br>점수' })));
    summary.appendChild(h('div', { class: 'kv' },
      h('div', null, '팀 ', h('b', { text: teams.length }), '개 · 학생 ', h('b', { text: prep.length }), '명',
        s.manualEdits ? h('span', { class: 'badge warn', text: '수동 조정됨' }) : h('span', { class: 'badge ok', text: '시드 ' + s.result.seed }),
        s.result.source === 'draft' ? h('span', { class: 'badge', text: ({ auto: '교사 편성 공개', pick: '팀별 드래프트', credit: '크레딧 드래프트' }[s.result.mode] || '드래프트') + ' 결과' }) : null),
      h('div', { class: 'teacher-only' }, 'PAPS 팀 평균 범위 ', h('b', { text: fmt(stats.Dp, 1) }), '점 (허용 ' + Number(o.papsTolerance).toFixed(1) + '점, 100점 만점)',
        ' · 인성 편차 지수 ', h('b', { text: fmt(stats.Dc, 2) }), h('span', { class: 'hint', text: ' (4덕목 팀 평균 SD ÷ 학생 SD 합, 작을수록 균등)' })),
      h('div', null, '성별 균형 ' + (o.genderBalance ? '켬' : '끔') + ' · 팀 평균 PAPS 점수·4덕목이 서로 비슷할수록 공정한 편성입니다.')
    ));
    (s.result.log || []).forEach(function (m) { log.appendChild(h('div', { class: 'log', text: m })); });

    /* 미배정 */
    var unIds = unassignedIds(s, teams);
    if (unIds.length) {
      un.appendChild(h('div', { class: 'unassigned' }, h('b', { text: '미배정 ' + unIds.length + '명' }), h('span', { class: 'hint', text: ' — 편성 후 추가된 학생입니다. 팀 카드로 끌어다 놓거나 다시 편성하세요.' }),
        h('ul', { class: 'members' }, unIds.map(function (id) { return memberEl(byId[id], s, -1); }))));
    }

    /* 팀 카드 */
    teams.forEach(function (ids, t) {
      var tm = stats.teams[t];
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
      teamsEl.appendChild(card);
    });
    if (!s.studentView) $('#dnd-hint').textContent = '학생을 다른 팀 카드로 끌어다 놓으면 이동하고, 학생을 클릭한 뒤 다른 학생을 클릭하면 서로 교환됩니다. 통계는 바로 다시 계산됩니다.';

    /* 균형표 */
    bal.className = 'balance';
    var table = h('table');
    table.appendChild(h('thead', null, h('tr', null, h('th', { text: '팀' }), h('th', { text: '인원' }), h('th', { text: '남' }), h('th', { text: '여' }), h('th', { text: 'PAPS 평균(점/100)' }), VK.map(function (k) { return h('th', { text: k + '(/5)' }); }))));
    var tb = h('tbody');
    stats.teams.forEach(function (tm, t) {
      tb.appendChild(h('tr', null, h('td', { class: 'tn' }, h('i', { class: 'dot', style: 'background:' + teamColor(t) }), teamName(t)), h('td', { text: tm.size }), h('td', { text: tm.male }), h('td', { text: tm.female }),
        h('td', { text: fmt(tm.meanPaps, 1) }), VK.map(function (k) { return h('td', { text: fmt(tm.meanVirtues[k], 2) }); })));
    });
    tb.appendChild(h('tr', { class: 'foot' }, h('td', { class: 'tn', text: '범위(최대−최소)' }), h('td'), h('td'), h('td'), h('td', { text: fmt(stats.metrics.PAPS.range, 1) }), VK.map(function (k) { return h('td', { text: fmt(stats.metrics[k].range, 2) }); })));
    tb.appendChild(h('tr', { class: 'foot' }, h('td', { class: 'tn', text: '팀 평균 표준편차' }), h('td'), h('td'), h('td'), h('td', { text: fmt(stats.metrics.PAPS.sd, 1) }), VK.map(function (k) { return h('td', { text: fmt(stats.metrics[k].sd, 2) }); })));
    tb.appendChild(h('tr', { class: 'foot' }, h('td', { class: 'tn', text: '학생 표준편차(참고)' }), h('td'), h('td'), h('td'), h('td', { text: fmt(stats.metrics.PAPS.studentSd, 1) }), VK.map(function (k) { return h('td', { text: fmt(stats.metrics[k].studentSd, 2) }); })));
    table.appendChild(tb);
    bal.appendChild(h('h3', { text: '팀 균형표' }));
    bal.appendChild(table);

    /* 차트 */
    charts.appendChild(dotPlot(stats));
    charts.appendChild(radar(stats));
  }

  function memberEl(p, s, team) {
    if (!p) return null;
    var pinned = s.options.pinned && s.options.pinned[p.id] !== undefined;
    var el = h('li', { class: 'member' + (selectedMember === p.id ? ' selected' : ''), dataset: { id: p.id }, draggable: !s.studentView,
      title: s.studentView ? '' : 'PAPS ' + fmt(p.papsPoints, 1) + '점 (' + p.papsGrade + '등급)' + (p.papsImputed ? ' (대체)' : '') + '\n' + VK.map(function (k) { return k + ' ' + fmt(p.virtues[k], 2); }).join(' · ') + (p.virtueImputed ? '\n(인성 일부 대체)' : '') },
      h('span', { class: 'no', text: p.no === null || p.no === undefined ? '' : p.no }),
      h('span', { class: 'nm', text: p.name || '(이름 없음)' }),
      p.gender ? h('span', { class: 'g ' + (p.gender === '남' ? 'm' : 'f'), text: p.gender }) : null,
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

  /* ---------- 차트: 지표별 팀 평균 점 그래프 ---------- */
  function dotPlot(stats) {
    var metrics = ['PAPS'].concat(VK);
    var W = 640, rowH = 40, labelW = 92, right = 80, top = 18;
    var H = top + metrics.length * rowH + 10;
    var root_ = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '지표별 팀 평균 분포' });
    metrics.forEach(function (mk, i) {
      var m = stats.metrics[mk];
      var y = top + i * rowH + rowH / 2;
      var tm = m.teamMeans;
      var center = tm.reduce(function (a, b) { return a + b; }, 0) / (tm.length || 1);
      var maxDev = tm.reduce(function (a, b) { return Math.max(a, Math.abs(b - center)); }, 0);
      var half = Math.max((m.studentSd || 0) * 0.5, maxDev * 1.15, 0.05);
      var x0 = labelW, x1 = W - right;
      var xOf = function (v) { return x0 + (v - center + half) / (2 * half) * (x1 - x0); };
      root_.appendChild(svg('text', { x: 8, y: y + 4, 'font-size': 13, 'font-weight': 600, fill: '#1b2430' }, mk === 'PAPS' ? 'PAPS(점)' : mk));
      root_.appendChild(svg('line', { x1: x0, x2: x1, y1: y, y2: y, stroke: '#dde3ec', 'stroke-width': 2 }));
      [-half, 0, half].forEach(function (d) {
        var x = xOf(center + d);
        root_.appendChild(svg('line', { x1: x, x2: x, y1: y - 6, y2: y + 6, stroke: '#c5cedb' }));
        root_.appendChild(svg('text', { x: x, y: y + 18, 'font-size': 9, fill: '#8a97a8', 'text-anchor': 'middle' }, (center + d).toFixed(mk === 'PAPS' ? 1 : 2)));
      });
      var lo = Math.min.apply(null, tm), hi = Math.max.apply(null, tm);
      root_.appendChild(svg('rect', { x: xOf(lo), y: y - 9, width: Math.max(2, xOf(hi) - xOf(lo)), height: 18, rx: 4, fill: '#1f6feb', 'fill-opacity': 0.08 }));
      tm.forEach(function (v, t) {
        var c = svg('circle', { cx: xOf(v), cy: y, r: 6.5, fill: teamColor(t), stroke: '#fff', 'stroke-width': 1.5 });
        c.appendChild(svg('title', null, teamName(t) + ' ' + mk + ' 평균 ' + v.toFixed(mk === 'PAPS' ? 1 : 2)));
        root_.appendChild(c);
      });
      root_.appendChild(svg('text', { x: W - 6, y: y + 4, 'font-size': 11, fill: '#5d6b7c', 'text-anchor': 'end' }, '범위 ' + m.range.toFixed(mk === 'PAPS' ? 1 : 2)));
    });
    var box = h('div', { class: 'chart' }, h('h4', { text: '지표별 팀 평균 분포 (점이 모여 있을수록 균등)' }), root_,
      h('div', { class: 'legend' }, stats.teams.map(function (_, t) { return h('span', null, h('i', { style: 'background:' + teamColor(t) }), teamName(t)); })));
    return box;
  }

  /* ---------- 차트: 4덕목 레이더 ---------- */
  function radar(stats) {
    var size = 320, cx = size / 2, cy = size / 2 + 6, R = 112;
    var all = [];
    VK.forEach(function (k) { all = all.concat(stats.metrics[k].teamMeans); });
    var lo = Math.max(1, Math.floor((Math.min.apply(null, all) - 0.15) * 10) / 10);
    var hi = Math.min(5, Math.ceil((Math.max.apply(null, all) + 0.15) * 10) / 10);
    if (hi - lo < 0.4) { var mid = (hi + lo) / 2; lo = Math.max(1, mid - 0.2); hi = Math.min(5, mid + 0.2); }
    var root_ = svg('svg', { viewBox: '0 0 ' + size + ' ' + (size + 10), role: 'img', 'aria-label': '4덕목 팀 평균 레이더' });
    var ang = function (i) { return -Math.PI / 2 + i * Math.PI / 2; };
    var pt = function (i, v) { var r = R * (v - lo) / (hi - lo); return [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))]; };
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var v = lo + (hi - lo) * f;
      var pts = VK.map(function (_, i) { return pt(i, v).join(','); }).join(' ');
      root_.appendChild(svg('polygon', { points: pts, fill: 'none', stroke: '#e3e8f0' }));
      root_.appendChild(svg('text', { x: cx + 4, y: pt(0, v)[1] - 2, 'font-size': 9, fill: '#8a97a8' }, v.toFixed(2)));
    });
    VK.forEach(function (k, i) {
      var p = pt(i, hi);
      root_.appendChild(svg('line', { x1: cx, y1: cy, x2: p[0], y2: p[1], stroke: '#dde3ec' }));
      var lx = cx + (R + 18) * Math.cos(ang(i)), ly = cy + (R + 18) * Math.sin(ang(i));
      root_.appendChild(svg('text', { x: lx, y: ly + 4, 'font-size': 12, 'font-weight': 600, fill: '#1b2430', 'text-anchor': 'middle' }, k));
    });
    stats.teams.forEach(function (tm, t) {
      var pts = VK.map(function (k, i) { return pt(i, tm.meanVirtues[k]).join(','); }).join(' ');
      var poly = svg('polygon', { points: pts, fill: teamColor(t), 'fill-opacity': 0.06, stroke: teamColor(t), 'stroke-width': 2 });
      poly.appendChild(svg('title', null, teamName(t) + ' ' + VK.map(function (k) { return k + ' ' + tm.meanVirtues[k].toFixed(2); }).join(', ')));
      root_.appendChild(poly);
    });
    return h('div', { class: 'chart' }, h('h4', { text: '4덕목 팀 평균 레이더 (겹칠수록 균등)' }), root_);
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
      try { var f = X.exportTeamsXlsx(s, prep, teams, A.evaluateTeams(prep, teams), { includeScores: includeScores, teamNames: s.teamNames }); toast(f + ' 저장'); }
      catch (e) { toast(e.message, true); }
    }
    $('#btn-xlsx').addEventListener('click', function () { doXlsx(false); });
    $('#btn-xlsx-teacher').addEventListener('click', function () { doXlsx(true); });
    $('#btn-json').addEventListener('click', function () { toast(X.exportSessionJSON(St.get()) + ' 저장'); });
    $('#json-input').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { try { St.importJSON(r.result); toast('세션을 불러왔습니다.'); } catch (err) { toast(err.message, true); } };
      r.readAsText(f, 'utf-8'); e.target.value = '';
    });
    $$('.btn-template').forEach(function (b) { b.addEventListener('click', function () { try { X.exportTemplateXlsx(b.dataset.kind); } catch (e) { toast(e.message, true); } }); });
    $('#btn-print').addEventListener('click', function () { window.print(); });
    $('#btn-print2').addEventListener('click', function () { window.print(); });
  }

  function renderTop(s) {
    setIfIdle($('#class-label'), s.classLabel || '');
    $('#student-view-toggle').checked = !!s.studentView;
    document.body.classList.toggle('student-view', !!s.studentView);
    var sel = $('#saved-select');
    var cur = sel.value;
    clear(sel);
    sel.appendChild(h('option', { value: '', text: '저장된 학급…' }));
    St.listSaved().forEach(function (e) { sel.appendChild(h('option', { value: e.label, text: e.label + ' (' + (e.updatedAt || '').slice(0, 10) + ')' })); });
    sel.value = cur && Array.prototype.some.call(sel.options, function (o) { return o.value === cur; }) ? cur : '';
    $('#btn-undo').disabled = !St.canUndo();
    $('#btn-undo2').disabled = !St.canUndo();
  }
  function bindTopEvents() {
    $('#class-label').addEventListener('change', function (e) { St.update(function (s) { s.classLabel = e.target.value.trim(); }, { noUndo: true }); });
    $('#student-view-toggle').addEventListener('change', function (e) { selectedMember = null; St.update(function (s) { s.studentView = e.target.checked; }, { noUndo: true }); });
    $('#btn-save-class').addEventListener('click', function () {
      var lbl = $('#class-label').value.trim() || prompt('학급 이름을 입력하세요 (예: 1-3)');
      if (!lbl) return;
      St.saveAs(lbl); toast('"' + lbl + '" 학급으로 저장했습니다.');
    });
    $('#saved-select').addEventListener('change', function (e) {
      var lbl = e.target.value; if (!lbl) return;
      if (confirm('"' + lbl + '" 학급 자료를 불러올까요? 현재 화면의 자료는 되돌리기로 복구할 수 있습니다.')) { St.loadSaved(lbl); toast('"' + lbl + '" 학급을 불러왔습니다.'); }
      else if (confirm('"' + lbl + '" 저장본을 삭제할까요?')) { St.deleteSaved(lbl); render(); }
      e.target.value = '';
    });
    $('#btn-undo').addEventListener('click', function () { if (!St.undo()) toast('되돌릴 작업이 없습니다.'); });
    $('#btn-undo2').addEventListener('click', function () { if (!St.undo()) toast('되돌릴 작업이 없습니다.'); });
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
    var prep = prepare(s);
    renderTop(s);
    renderImportStatus(s);
    renderRoster(s, prep);
    renderSettings(s, prep);
    renderResult(s, prep);
  }

  function init() {
    bindTopEvents(); bindImportEvents(); bindRosterEvents(); bindSettingsEvents(); bindExportEvents();
    St.onChange(render);
    render();
    if (!root.XLSX) toast('엑셀 라이브러리를 불러오지 못했습니다. xlsx 파일 대신 CSV/붙여넣기를 사용하세요.', true);
  }

  root.AgoraUI = { init: init, render: render, build: build, loadFile: loadRowsFromFile };
})(window);
