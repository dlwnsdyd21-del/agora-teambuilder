/* ============================================================
 * parse.js — 파일/붙여넣기 → 표 → 열 자동 인식 → 학생 레코드
 *  - NEIS 학급별일괄입력 xlsx (PAPS 원기록)
 *  - NEIS 학급별건강체력평가조회 xlsx (2줄 헤더, 영역별 점수·등급·총점 포함)
 *  - 구글폼 응답 (학번 "10130 홍길동", 32문항 객관식 "④ 그렇다" 등)
 *  - 4덕목 점수 / PAPS 총점·등급 직접 입력 표
 *  - 번호 기준 병합
 * ============================================================ */
(function (root) {
  'use strict';

  var Q = root.AgoraQuestions || (typeof require === 'function' ? require('./questions.js') : null);
  var S = root.AgoraScoring || (typeof require === 'function' ? require('./scoring.js') : null);

  /* ---------- 필드 정의 (매핑 UI에서도 사용) ---------- */
  var FIELD_DEFS = [
    { key: 'no', label: '번호', group: '기본' },
    { key: 'hakbun', label: '학번 (예: 10130 홍길동)', group: '기본' },
    { key: 'name', label: '이름', group: '기본' },
    { key: 'gender', label: '성별', group: '기본' },
    { key: 'grade', label: '학년', group: '기본' },
    { key: 'run', label: '왕복오래달리기(회)', group: 'PAPS 원기록' },
    { key: 'flex1', label: '앉아윗몸앞으로굽히기 1차', group: 'PAPS 원기록' },
    { key: 'flex2', label: '앉아윗몸앞으로굽히기 2차', group: 'PAPS 원기록' },
    { key: 'situp', label: '윗몸말아올리기(회)', group: 'PAPS 원기록' },
    { key: 'pushup', label: '팔굽혀펴기(회)', group: 'PAPS 원기록' },
    { key: 'grip', label: '악력(kg)', group: 'PAPS 원기록' },
    { key: 'jump1', label: '제자리멀리뛰기 1차', group: 'PAPS 원기록' },
    { key: 'jump2', label: '제자리멀리뛰기 2차', group: 'PAPS 원기록' },
    { key: 'run50', label: '50m달리기(초)', group: 'PAPS 원기록' },
    { key: 'height', label: '신장(cm)', group: 'PAPS 원기록' },
    { key: 'weight', label: '체중(kg)', group: 'PAPS 원기록' },
    { key: 'bmi', label: 'BMI(kg/㎡)', group: 'PAPS 원기록' },
    { key: 'papsGiven', label: 'PAPS 총점/등급 (계산값)', group: 'PAPS 계산값' },
    { key: 'pts_심폐', label: '심폐지구력 점수 (나이스)', group: 'PAPS 계산값' },
    { key: 'pts_유연', label: '유연성 점수 (나이스)', group: 'PAPS 계산값' },
    { key: 'pts_근력', label: '근력·근지구력 점수 (나이스)', group: 'PAPS 계산값' },
    { key: 'pts_순발', label: '순발력 점수 (나이스)', group: 'PAPS 계산값' },
    { key: 'pts_체지방', label: '비만(BMI) 점수 (나이스)', group: 'PAPS 계산값' },
    { key: 'bmiCat', label: '비만 등급(정상/과체중 등)', group: 'PAPS 계산값' },
    { key: 'v_성실', label: '성실 (평균)', group: '인성 4덕목' },
    { key: 'v_협동', label: '협동 (평균)', group: '인성 4덕목' },
    { key: 'v_정의', label: '정의 (평균)', group: '인성 4덕목' },
    { key: 'v_배려', label: '배려 (평균)', group: '인성 4덕목' }
  ];

  function norm(s) {
    return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[\s ·,.()\[\]:;'"?!~_\-\/㎡²]/g, '');
  }
  function cellStr(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  var ITEM_KEYS = Q.ITEMS.map(function (t) { return norm(t).slice(0, 12); });
  var B_KEYS = Q.B_ITEMS.map(function (t) { return norm(t).slice(0, 12); });

  /* 리커트 응답 → 1~5 (숫자, ①~⑤, "4 (그렇다)", "매우 그렇다" 등) */
  var CIRCLED = { '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7 };
  function likertValue(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s) return null;
    if (CIRCLED[s.charAt(0)]) return CIRCLED[s.charAt(0)];
    var m = s.match(/^\s*(\d)(?![\d.])/);
    if (m) return parseInt(m[1], 10);
    var t = s.replace(/\s/g, '');
    if (t.indexOf('전혀') >= 0) return 1;
    if (t.indexOf('매우') >= 0) return 5;
    if (t.indexOf('보통') >= 0) return 3;
    if (t.indexOf('그렇지') >= 0 || t.indexOf('아니') >= 0) return 2;
    if (t.indexOf('그렇다') >= 0 || t.indexOf('그래') >= 0) return 4;
    return S.toNum(s);
  }

  /* 헤더 문자열 하나를 필드로 분류 */
  function classifyHeader(h) {
    var raw = cellStr(h), n = norm(raw);
    if (!n) return null;
    if (n === '타임스탬프' || n === 'timestamp' || n === '학교' || n === '학교명' || n === '이메일' || n === '이메일주소') return { field: 'ignore' };
    /* B문항 제외 */
    if (/^b\d{1,2}/.test(n)) return { field: 'ignore' };
    for (var b = 0; b < B_KEYS.length; b++) if (n.indexOf(B_KEYS[b]) >= 0) return { field: 'ignore' };
    /* 32문항: 번호형 (1, 1., Q1, 문항1, 1) …) */
    var m = raw.match(/^\s*(?:q|문항|문|item)?\s*(\d{1,2})\s*(?:[.)\]:：]|$)/i);
    if (m) {
      var k = parseInt(m[1], 10);
      if (k >= 1 && k <= 32) return { field: 'item', item: k };
    }
    /* 32문항: 원문형 */
    for (var i = 0; i < ITEM_KEYS.length; i++) if (n.indexOf(ITEM_KEYS[i]) >= 0) return { field: 'item', item: i + 1 };
    /* 4덕목 (짧은 헤더만) */
    var vm = raw.replace(/\s/g, '').match(/^(성실|협동|정의|배려)(평균|점수|덕목)?$/);
    if (vm) return { field: 'v_' + vm[1] };
    /* 기본 */
    if (n === '번호' || n === '학생번호' || n === '출석번호' || n === 'no' || n === 'number') return { field: 'no' };
    if (n === '학번' || n === '학번이름' || n === '학번성명' || n === '학번(예10130홍길동)') return { field: 'hakbun' };
    if (n === '학생성명' || n === '성명' || n === '이름' || n === '학생명' || n === '학생이름' || n === 'name') return { field: 'name' };
    if (n === '성별' || n === 'gender' || n === 'sex') return { field: 'gender' };
    if (n === '학년' || n === 'grade') return { field: 'grade' };
    /* NEIS 조회 양식: 영역별 점수·등급 (2줄 헤더 결합 텍스트) */
    var isPts = n.indexOf('점수') >= 0, isGr = n.indexOf('등급') >= 0;
    if (n.indexOf('건강체력평가') >= 0 || n.indexOf('신체능력') >= 0 || n.indexOf('종합점수') >= 0) {
      if (isPts || n.indexOf('총점') >= 0) return { field: 'papsGiven', papsGivenType: 'score' };
      if (isGr) return { field: 'ignore' };
    }
    if (isPts || isGr) {
      var area = n.indexOf('심폐') >= 0 ? '심폐' : n.indexOf('유연') >= 0 ? '유연' : (n.indexOf('근력') >= 0 || n.indexOf('근지구력') >= 0) ? '근력'
        : n.indexOf('순발') >= 0 ? '순발' : (n.indexOf('비만') >= 0 || n.indexOf('체지방') >= 0 || n.indexOf('bmi') >= 0 || n.indexOf('체질량') >= 0) ? '체지방' : null;
      if (area && isPts && !/왕복|굽히기|말아올리기|팔굽혀|악력|멀리뛰기|50m|걷기|스텝/.test(n)) return { field: 'pts_' + area };
      if (area === '체지방' && isGr) return { field: 'bmiCat' };
      if (area && isGr) return { field: 'ignore' };
    }
    /* PAPS 원기록 (순서 중요: 걷기 → 왕복, 굽히기 → 윗몸) */
    if (n.indexOf('걷기') >= 0 || n.indexOf('스텝') >= 0 || n.indexOf('종합유연성') >= 0 || n.indexOf('pei') >= 0) return { field: 'ignore' };
    if (n.indexOf('왕복') >= 0 || n.indexOf('오래달리기') >= 0 || n.indexOf('셔틀런') >= 0 || n.indexOf('페이서') >= 0) return { field: 'run' };
    if (n.indexOf('50m') >= 0 || n.indexOf('50미터') >= 0) return { field: 'run50' };
    if (n.indexOf('굽히기') >= 0 || n.indexOf('유연') >= 0) return { field: /2차|2회|second/.test(n) ? 'flex2' : 'flex1', trial: /2차|2회/.test(n) ? 2 : (/1차|1회/.test(n) ? 1 : 0) };
    if (n.indexOf('팔굽혀') >= 0) return { field: 'pushup' };
    if (n.indexOf('악력') >= 0) return { field: 'grip' };
    if (n.indexOf('말아올리기') >= 0 || n.indexOf('윗몸') >= 0 || n.indexOf('근지구력') >= 0) return { field: 'situp' };
    if (n.indexOf('멀리뛰기') >= 0 || n.indexOf('순발력') >= 0) return { field: /2차|2회/.test(n) ? 'jump2' : 'jump1', trial: /2차|2회/.test(n) ? 2 : (/1차|1회/.test(n) ? 1 : 0) };
    if (n.indexOf('신장') >= 0 || n === '키' || n === '키cm' || n === 'height') return { field: 'height' };
    if (n.indexOf('체중') >= 0 || n.indexOf('몸무게') >= 0 || n === 'weight') return { field: 'weight' };
    if (n.indexOf('bmi') >= 0 || n.indexOf('체질량') >= 0) return { field: 'bmi' };
    /* PAPS 계산값 */
    if ((n.indexOf('paps') >= 0 || n.indexOf('팝스') >= 0) && (n.indexOf('총점') >= 0 || n.indexOf('점수') >= 0 || n.indexOf('등급') >= 0 || n.indexOf('종합') >= 0)) {
      return { field: 'papsGiven', papsGivenType: n.indexOf('등급') >= 0 ? 'grade' : 'score' };
    }
    if (n === '총점' || n === '등급' || n === 'paps' || n === '팝스' || n === '체력점수' || n === '체력등급') {
      return { field: 'papsGiven', papsGivenType: n.indexOf('등급') >= 0 ? 'grade' : 'score' };
    }
    return null;
  }

  /* 한 헤더 배열을 매핑으로 */
  function mapHeaderRow(row) {
    var mapping = { items: new Array(32).fill(-1) };
    var score = 0, itemCount = 0;
    var flexSeen = 0, jumpSeen = 0;
    row.forEach(function (h, c) {
      var cl = classifyHeader(h);
      if (!cl || cl.field === 'ignore') return;
      if (cl.field === 'item') {
        if (mapping.items[cl.item - 1] < 0) { mapping.items[cl.item - 1] = c; itemCount++; }
        return;
      }
      var f = cl.field;
      if (f === 'flex1' || f === 'flex2') { if (!cl.trial) f = flexSeen === 0 ? 'flex1' : 'flex2'; flexSeen++; }
      if (f === 'jump1' || f === 'jump2') { if (!cl.trial) f = jumpSeen === 0 ? 'jump1' : 'jump2'; jumpSeen++; }
      if (mapping[f] === undefined) {
        mapping[f] = c; score++;
        if (f === 'papsGiven') mapping.papsGivenType = cl.papsGivenType;
      }
    });
    if (itemCount > 0) score += 1 + Math.min(3, Math.floor(itemCount / 8));
    mapping.itemCount = itemCount;
    return { mapping: mapping, score: score };
  }

  /* 병합 셀이 있는 윗줄 헤더: 빈 칸은 왼쪽 값을 이어받음 */
  function carryForward(row, width) {
    var out = [], last = '';
    for (var c = 0; c < width; c++) {
      var v = row && c < row.length ? cellStr(row[c]) : '';
      if (v) last = v;
      out.push(last);
    }
    return out;
  }
  /* 윗줄(영역) + 아랫줄(세부) 결합. 아랫줄이 비어 있으면 윗줄의 '원래' 칸만 사용(병합 연속 칸은 비움) */
  function combineHeaders(upper, lower) {
    var width = Math.max(upper ? upper.length : 0, lower ? lower.length : 0);
    var up = carryForward(upper, width);
    var out = [];
    for (var c = 0; c < width; c++) {
      var lo = lower && c < lower.length ? cellStr(lower[c]) : '';
      var own = upper && c < upper.length ? cellStr(upper[c]) : '';
      if (lo) out.push((up[c] + ' ' + lo).trim());
      else out.push(own);
    }
    return out;
  }

  /* 값 기반 32문항 열 추정 (헤더 인식 실패 시) */
  function guessItemsByValues(rows, headerRow, mapping) {
    var used = {};
    Object.keys(mapping).forEach(function (k) { if (typeof mapping[k] === 'number' && mapping[k] >= 0) used[mapping[k]] = true; });
    var width = 0;
    rows.forEach(function (r) { if (r && r.length > width) width = r.length; });
    var dataRows = rows.slice(headerRow + 1).filter(function (r) { return r && r.some(function (v) { return cellStr(v) !== ''; }); });
    if (!dataRows.length) return null;
    function likert(c) {
      var n = 0;
      for (var i = 0; i < dataRows.length; i++) {
        var v = dataRows[i][c];
        if (v === null || v === undefined || cellStr(v) === '') continue;
        var x = likertValue(v);
        if (x === null || x < 1 || x > 5 || Math.floor(x) !== x) return false;
        n++;
      }
      return n > 0;
    }
    var run = [];
    for (var c = 0; c < width; c++) {
      if (!used[c] && likert(c)) { run.push(c); if (run.length === 32) return run; }
      else run = [];
    }
    return null;
  }

  /* 제목 줄에서 학년 힌트 ("2026 학년도  주간  1") */
  function gradeHintFromRows(rows, headerRow) {
    for (var r = 0; r < headerRow; r++) {
      var txt = (rows[r] || []).map(cellStr).join(' ').replace(/\s+/g, ' ').trim();
      var m = txt.match(/학년도\s+\S+\s+(\d)(?:\s|$)/) || txt.match(/(\d)\s*학년(?:\s|$)/);
      if (m) { var g = parseInt(m[1], 10); if (g >= 1 && g <= 6) return g; }
    }
    return null;
  }

  /*
   * rows: 2차원 배열. 반환 { headerRow, headers, mapping, warnings, meta }
   */
  function detectTable(rows) {
    var bestRow = 0, best = null, bestHeaders = null;
    var limit = Math.min(rows.length, 12);
    for (var r = 0; r < limit; r++) {
      if (!rows[r]) continue;
      var m = mapHeaderRow(rows[r]);
      var headers = (rows[r] || []).map(cellStr);
      /* 2줄 헤더(NEIS 조회): 이 줄에 번호·이름이 없고 윗줄에 있으면 결합해서 다시 시도 */
      if (r > 0 && rows[r - 1] && m.mapping.no === undefined && m.mapping.name === undefined && m.mapping.hakbun === undefined) {
        var up = mapHeaderRow(rows[r - 1]).mapping;
        if (up.no !== undefined || up.name !== undefined) {
          var combined = combineHeaders(rows[r - 1], rows[r]);
          var m2 = mapHeaderRow(combined);
          if (m2.score >= m.score) { m = m2; headers = combined; m.twoRow = true; }
        }
      }
      if (!best || m.score > best.score) { best = m; bestRow = r; bestHeaders = headers; }
    }
    if (!best) { best = { mapping: { items: new Array(32).fill(-1), itemCount: 0 }, score: 0 }; bestHeaders = []; }
    var mapping = best.mapping;
    var warnings = [];
    if (mapping.itemCount > 0 && mapping.itemCount < 32) warnings.push('32문항 중 ' + mapping.itemCount + '개 열만 인식했습니다. 매핑을 확인해 주세요.');
    if (mapping.itemCount === 0 && mapping['v_성실'] === undefined && mapping.run === undefined && mapping.papsGiven === undefined && mapping['pts_심폐'] === undefined) {
      var guess = guessItemsByValues(rows, bestRow, mapping);
      if (guess) { mapping.items = guess; mapping.itemCount = 32; warnings.push('헤더에서 문항 번호를 찾지 못해 1~5 값이 있는 연속 32열을 문항으로 추정했습니다.'); }
    }
    if (mapping.no === undefined && mapping.name === undefined && mapping.hakbun === undefined) warnings.push('번호/학번/이름 열을 찾지 못했습니다. 매핑에서 지정해 주세요.');
    var meta = { twoRowHeader: !!best.twoRow, gradeHint: gradeHintFromRows(rows, bestRow), neis: mapping['pts_심폐'] !== undefined || mapping['pts_유연'] !== undefined };
    return { headerRow: bestRow, headers: bestHeaders, mapping: mapping, warnings: warnings, score: best.score, meta: meta };
  }

  function parseGender(v) {
    var s = cellStr(v).toLowerCase();
    if (!s) return null;
    if (/^(남|남자|남학생|m|male|boy|1)$/.test(s) || s.charAt(0) === '남') return '남';
    if (/^(여|여자|여학생|f|female|girl|2)$/.test(s) || s.charAt(0) === '여') return '여';
    return null;
  }
  function parseNo(v) {
    var x = S.toNum(v);
    if (x === null) return null;
    x = Math.round(x);
    return x > 0 && x < 1000 ? x : null;
  }
  /* 학번 "10130 홍길동" → {grade:1, cls:1, no:30, name:'홍길동'}; "30" → {no:30} */
  function parseHakbun(v) {
    var s = cellStr(v);
    if (!s) return null;
    var m = s.match(/^\s*(\d{4,5})\s*[-_ ]?\s*([^\d\s][^\s]*)?/);
    if (m) {
      var d = m[1];
      var grade, cls, no;
      if (d.length === 5) { grade = +d.charAt(0); cls = +d.slice(1, 3); no = +d.slice(3); }
      else { grade = +d.charAt(0); cls = +d.charAt(1); no = +d.slice(2); }
      return { grade: grade >= 1 && grade <= 6 ? grade : null, cls: cls || null, no: no > 0 ? no : null, name: m[2] ? m[2].trim() : null };
    }
    var m2 = s.match(/^\s*(\d{1,2})\s*(?:번)?\s*([^\d\s]+)?/);
    if (m2) return { grade: null, cls: null, no: +m2[1], name: m2[2] ? m2[2].trim() : null };
    return null;
  }

  /* 표 + 매핑 → 학생 레코드 배열 */
  function extractStudents(rows, det) {
    var m = det.mapping, out = [];
    var meta = det.meta || {};
    function cell(row, key) { var c = m[key]; return (c === undefined || c < 0) ? null : row[c]; }
    for (var r = det.headerRow + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row.some(function (v) { return cellStr(v) !== ''; })) continue;
      /* 페이지마다 반복되는 헤더 행 건너뛰기 */
      var noTxt = cellStr(cell(row, 'no')), nameTxt = cellStr(cell(row, 'name'));
      if (/^(번호|학번|no)$/i.test(noTxt) || /^(성명|이름|학생성명|학생명)$/.test(nameTxt)) continue;
      var no = parseNo(cell(row, 'no'));
      var name = nameTxt || null;
      var gradeVal = S.toNum(cell(row, 'grade'));
      var grade = (gradeVal !== null && gradeVal >= 1 && gradeVal <= 6) ? Math.round(gradeVal) : null;
      var hb = parseHakbun(cell(row, 'hakbun'));
      if (hb) {
        if (no === null && hb.no !== null) no = hb.no;
        if (!name && hb.name) name = hb.name;
        if (grade === null && hb.grade !== null) grade = hb.grade;
      }
      if (no === null && !name) continue;
      if (grade === null && meta.gradeHint) grade = meta.gradeHint;
      var rec = { no: no, name: name, gender: parseGender(cell(row, 'gender')), grade: grade,
                  papsRaw: null, papsGiven: null, papsNeis: null, items: null, virtuesGiven: null };
      var rawKeys = ['run', 'flex1', 'flex2', 'situp', 'pushup', 'grip', 'jump1', 'jump2', 'run50', 'height', 'weight', 'bmi'];
      var raw = {}, anyRaw = false;
      rawKeys.forEach(function (k) {
        var v = S.toNum(cell(row, k));
        raw[k] = v; if (v !== null) anyRaw = true;
      });
      if (anyRaw) rec.papsRaw = raw;
      var pg = S.toNum(cell(row, 'papsGiven'));
      if (pg !== null) rec.papsGiven = pg;
      /* NEIS 영역별 점수 */
      var areas = {}, anyArea = false;
      ['심폐', '유연', '근력', '순발', '체지방'].forEach(function (a) {
        var v = S.toNum(cell(row, 'pts_' + a));
        if (v !== null) { areas[a] = v; anyArea = true; }
      });
      if (anyArea) rec.papsNeis = { areas: areas, total: pg, bmiCat: cellStr(cell(row, 'bmiCat')) || null };
      if (m.itemCount > 0) {
        var items = m.items.map(function (c) { return c < 0 ? null : likertValue(row[c]); });
        if (items.some(function (v) { return v !== null; })) rec.items = items;
      }
      var vg = {}, anyV = false;
      Q.VIRTUE_KEYS.forEach(function (k) {
        var v = S.toNum(cell(row, 'v_' + k));
        vg[k] = v; if (v !== null) anyV = true;
      });
      if (anyV) rec.virtuesGiven = vg;
      out.push(rec);
    }
    return out;
  }

  /* ---------- 텍스트 붙여넣기 (탭/쉼표, 따옴표 지원) ---------- */
  function parseDelimitedText(text) {
    text = String(text || '').replace(/\r\n?/g, '\n');
    var firstLine = text.split('\n')[0] || '';
    var delim = firstLine.indexOf('\t') >= 0 ? '\t' : (firstLine.indexOf(',') >= 0 ? ',' : '\t');
    var rows = [], row = [], field = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return cellStr(v) !== ''; }); })
      .map(function (r) { return r.map(function (v) { return v.trim(); }); });
  }

  /* ---------- xlsx (브라우저, SheetJS 전역 필요) ---------- */
  function readWorkbook(arrayBuffer) {
    var XLSX = root.XLSX;
    if (!XLSX) throw new Error('엑셀 라이브러리(SheetJS)를 불러오지 못했습니다. 인터넷 연결 또는 vendor/xlsx.full.min.js 를 확인하세요.');
    var wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
    return wb.SheetNames.map(function (name) {
      var ws = wb.Sheets[name];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
      return { name: name, rows: rows };
    });
  }

  /* ---------- 병합 ---------- */
  function keyOf(rec) { return rec.no !== null && rec.no !== undefined ? 'n' + rec.no : (rec.name ? 'm' + norm(rec.name) : null); }

  /* paps: PAPS 파일 레코드, survey: 인성 파일 레코드 → 세션 학생 배열 */
  function mergeStudents(papsRecs, surveyRecs) {
    var map = {}, order = [];
    function ensure(rec) {
      var k = keyOf(rec);
      if (!k) return null;
      if (!map[k]) {
        map[k] = { id: k, no: rec.no === undefined ? null : rec.no, name: rec.name || null, gender: null, grade: null,
          papsRaw: null, papsGiven: null, papsNeis: null, items: null, virtuesGiven: null, source: { paps: false, survey: false } };
        order.push(k);
      }
      return map[k];
    }
    (papsRecs || []).forEach(function (r) {
      var s = ensure(r); if (!s) return;
      s.source.paps = true;
      if (!s.name && r.name) s.name = r.name;
      if (r.gender && !s.gender) s.gender = r.gender;
      if (r.grade && !s.grade) s.grade = r.grade;
      if (r.papsRaw) s.papsRaw = r.papsRaw;
      if (r.papsGiven !== null && r.papsGiven !== undefined) s.papsGiven = r.papsGiven;
      if (r.papsNeis) s.papsNeis = r.papsNeis;
      if (r.items) s.items = r.items;
      if (r.virtuesGiven) s.virtuesGiven = r.virtuesGiven;
    });
    (surveyRecs || []).forEach(function (r) {
      var s = ensure(r); if (!s) return;
      s.source.survey = true;
      if (!s.name && r.name) s.name = r.name;
      if (r.gender) s.gender = r.gender;
      if (r.grade && !s.grade) s.grade = r.grade;
      if (r.items) s.items = r.items;
      if (r.virtuesGiven) s.virtuesGiven = r.virtuesGiven;
      if (r.papsRaw && !s.papsRaw) s.papsRaw = r.papsRaw;
      if (r.papsGiven !== null && r.papsGiven !== undefined && s.papsGiven === null) s.papsGiven = r.papsGiven;
      if (r.papsNeis && !s.papsNeis) s.papsNeis = r.papsNeis;
    });
    var list = order.map(function (k) { return map[k]; });
    list.sort(function (a, b) {
      if (a.no !== null && b.no !== null) return a.no - b.no;
      if (a.no !== null) return -1;
      if (b.no !== null) return 1;
      return String(a.name).localeCompare(String(b.name), 'ko');
    });
    return list;
  }

  var api = {
    FIELD_DEFS: FIELD_DEFS, classifyHeader: classifyHeader, detectTable: detectTable, extractStudents: extractStudents,
    parseDelimitedText: parseDelimitedText, readWorkbook: readWorkbook, mergeStudents: mergeStudents,
    parseGender: parseGender, parseNo: parseNo, parseHakbun: parseHakbun, likertValue: likertValue, combineHeaders: combineHeaders
  };
  root.AgoraParse = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
