/* ============================================================
 * state.js — 세션 상태, localStorage 자동저장, 되돌리기, 학급별 보관
 * ============================================================ */
(function (root) {
  'use strict';

  var KEY = 'agora.teambuilder.v1';
  var SAVED_KEY = 'agora.teambuilder.saved.v1';

  var DEFAULT_OPTIONS = {
    teamCount: 6, genderBalance: true, papsTolerance: 3, includeBmi: true,
    schoolLevel: '중', defaultGrade: 1, papsGivenType: 'score', seed: 1, together: [], apart: [], pinned: {},
    draftMode: 'auto', creditFitnessWeight: 0.6, draftTimerSec: 0, draftAnonymous: true,
    captains: {}                               // 드래프트 팀 주장: {팀 번호: 학생 id}
  };
  var HISTORY_MAX = 5;                         // 새로운 조합 편성에 참고하는 지난 편성 수

  function newSession() {
    return {
      version: 1, classLabel: '', updatedAt: null,
      classInfo: null,                         // {grade, cls} — 불러온 자료의 학급 (다른 반 자료 혼입 방지)
      students: [],                            // 학생: {..., status?: ''|'absent'|'limited'|'role'} (결석·활동 제한·기록/심판은 편성에서 제외), papsOverride?: 교사 수정 PAPS 총점
      options: JSON.parse(JSON.stringify(DEFAULT_OPTIONS)),
      imports: { paps: null, survey: null },   // {fileName, sheetName, rowCount, mappingSummary}
      result: null,                            // {teams:[[ids]], seed, log, builtAt, source?: 'auto'|'draft', mode?, captains?: [id|null]}
      teamHistory: [],                         // 지난 편성들 [[[ids]]] (최근 것이 앞) — "새로운 조합" 편성 때 같은 팀이 덜 겹치게
      manualEdits: false,
      studentView: false,
      teamNames: [],                           // 드래프트 화면에서 정한 팀 이름
      draft: null                              // 진행 중/완료된 드래프트 상태 (draft_logic)
    };
  }

  var state = { session: newSession(), undo: [], listeners: [], saveTimer: null };

  function hydrate(obj) {
    var s = newSession();
    if (!obj || typeof obj !== 'object') return s;
    Object.keys(s).forEach(function (k) { if (obj[k] !== undefined) s[k] = obj[k]; });
    s.options = Object.assign({}, DEFAULT_OPTIONS, obj.options || {});
    /* 구버전(z점수 단위 허용편차) 세션 이전 */
    if (typeof s.options.papsTolerance !== 'number' || s.options.papsTolerance < 1) s.options.papsTolerance = DEFAULT_OPTIONS.papsTolerance;
    if (!Array.isArray(s.students)) s.students = [];
    if (!s.imports) s.imports = { paps: null, survey: null };
    if (!Array.isArray(s.teamHistory)) s.teamHistory = [];
    s.options.captains = (s.options.captains && typeof s.options.captains === 'object') ? Object.assign({}, s.options.captains) : {};   // 기본값 객체를 공유하지 않도록 복사
    return s;
  }

  /* ---------- 지난 편성 (새로운 조합용) ---------- */
  /* 지금 결과를 지난 편성 목록 맨 앞에 넣음 — 결과를 새 편성으로 바꾸기 직전에 호출 */
  function teamsKey(teams) { return JSON.stringify((teams || []).map(function (t) { return (t || []).slice().sort(); })); }
  /* newTeams: 곧 저장할 새 편성 — 지금 결과와 같으면(같은 편성을 다시 저장) 남기지 않음 */
  function rememberResult(session, newTeams) {
    var r = session.result;
    if (!r || !Array.isArray(r.teams) || !r.teams.some(function (t) { return t && t.length; })) return;
    if (!Array.isArray(session.teamHistory)) session.teamHistory = [];
    var key = teamsKey(r.teams);
    if (newTeams && teamsKey(newTeams) === key) return;
    if (session.teamHistory.length && teamsKey(session.teamHistory[0]) === key) return;
    session.teamHistory.unshift(r.teams.map(function (t) { return (t || []).slice(); }));
    if (session.teamHistory.length > HISTORY_MAX) session.teamHistory.length = HISTORY_MAX;
  }
  /* 지금 결과 + 지난 편성들 (최근 것이 앞) */
  function pastTeams(session) {
    var out = [];
    if (session.result && Array.isArray(session.result.teams) && session.result.teams.some(function (t) { return t && t.length; })) out.push(session.result.teams);
    return out.concat(Array.isArray(session.teamHistory) ? session.teamHistory : []).slice(0, HISTORY_MAX + 1);
  }

  function load() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      if (raw) state.session = hydrate(JSON.parse(raw));
    } catch (e) { state.session = newSession(); }
    return state.session;
  }

  function persistNow() {
    try {
      state.session.updatedAt = new Date().toISOString();
      root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(state.session));
    } catch (e) { /* 용량 초과 등 — 앱은 계속 동작 */ }
  }
  function save() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(persistNow, 300);
  }

  function get() { return state.session; }

  /* ---------- 참여 상태 (결석·활동 제한·기록/심판 학생은 오늘 편성에서 제외) ---------- */
  var STATUS_LABEL = { absent: '결석', limited: '활동 제한', role: '기록·심판' };
  function isActive(st) { return !st.status || st.status === 'active'; }
  function activeStudents(session) { return (session || state.session).students.filter(isActive); }
  function inactiveStudents(session) { return (session || state.session).students.filter(function (s) { return !isActive(s); }); }

  function pushUndo() {
    state.undo.push(JSON.stringify(state.session));
    if (state.undo.length > 40) state.undo.shift();
  }

  /* fn(session) 안에서 상태를 바꾼다. opts.noUndo: 되돌리기 스택에 쌓지 않음 */
  function update(fn, opts) {
    if (!opts || !opts.noUndo) pushUndo();
    fn(state.session);
    save();
    emit();
  }
  function undo() {
    if (!state.undo.length) return false;
    state.session = hydrate(JSON.parse(state.undo.pop()));
    save(); emit();
    return true;
  }
  function canUndo() { return state.undo.length > 0; }

  function reset() { pushUndo(); state.session = newSession(); save(); emit(); }
  /* 이 브라우저에 저장된 이 앱의 모든 자료(현재 화면·저장된 학급·화면 설정)를 지움. 되돌리기 기록도 비움 */
  function wipeAll() {
    clearTimeout(state.saveTimer);
    try {
      var ls = root.localStorage, keys = [];
      for (var i = 0; ls && i < ls.length; i++) { var k = ls.key(i); if (k && k.indexOf('agora.') === 0) keys.push(k); }
      keys.forEach(function (k) { ls.removeItem(k); });
    } catch (e) { /* ignore */ }
    try { root.sessionStorage && root.sessionStorage.clear(); } catch (e) { /* ignore */ }
    state.undo = [];
    state.session = newSession();
  }
  function replace(obj) { pushUndo(); state.session = hydrate(obj); save(); emit(); }

  function onChange(fn) { state.listeners.push(fn); }
  function emit() {
    state.listeners.forEach(function (fn) { try { fn(state.session); } catch (e) { console.error(e); } });
  }

  /* ---------- 세션 파일 ---------- */
  function exportJSON() { return JSON.stringify(state.session, null, 2); }
  function importJSON(text) {
    var obj = JSON.parse(text);
    if (!obj || !Array.isArray(obj.students)) throw new Error('팀편성 세션 파일 형식이 아닙니다.');
    replace(obj);
  }

  /* ---------- 학급별 보관 ---------- */
  function listSaved() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(SAVED_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function writeSaved(arr) {
    try { root.localStorage && root.localStorage.setItem(SAVED_KEY, JSON.stringify(arr)); } catch (e) { /* ignore */ }
  }
  function saveAs(label) {
    var arr = listSaved();
    var lbl = String(label || state.session.classLabel || '이름 없음').trim();
    var entry = { label: lbl, updatedAt: new Date().toISOString(), session: JSON.parse(JSON.stringify(state.session)) };
    entry.session.classLabel = lbl;
    var idx = arr.findIndex(function (e) { return e.label === lbl; });
    if (idx >= 0) arr[idx] = entry; else arr.push(entry);
    writeSaved(arr);
    update(function (s) { s.classLabel = lbl; }, { noUndo: true });
    return arr;
  }
  function loadSaved(label) {
    var e = listSaved().find(function (x) { return x.label === label; });
    if (!e) return false;
    replace(e.session);
    return true;
  }
  /* 저장본 하나 읽기(세션 객체 복사) / 현재 화면을 바꾸지 않고 저장본 갱신 */
  function getSaved(label) {
    var e = listSaved().find(function (x) { return x.label === label; });
    return e ? hydrate(JSON.parse(JSON.stringify(e.session))) : null;
  }
  function putSaved(label, sessionObj) {
    var arr = listSaved();
    var lbl = String(label || '').trim();
    if (!lbl) return arr;
    var entry = { label: lbl, updatedAt: new Date().toISOString(), session: JSON.parse(JSON.stringify(sessionObj)) };
    entry.session.classLabel = lbl;
    var idx = arr.findIndex(function (e) { return e.label === lbl; });
    if (idx >= 0) arr[idx] = entry; else arr.push(entry);
    writeSaved(arr);
    return arr;
  }
  function deleteSaved(label) {
    writeSaved(listSaved().filter(function (x) { return x.label !== label; }));
  }
  /* 학급 목록 순서: 한 칸 위(dir −1)·아래(+1)로 옮기기 / 이름순 정렬("1-2" < "1-10" 처럼 숫자를 수로 비교) */
  function moveSaved(label, dir) {
    var arr = listSaved();
    var i = arr.findIndex(function (e) { return e.label === label; }), j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= arr.length) return arr;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    writeSaved(arr);
    return arr;
  }
  /* 주어진 이름 순서대로 다시 배열 (목록에 없는 이름은 무시, 빠진 학급은 뒤에 원래 순서로) */
  function reorderSaved(labels) {
    var arr = listSaved(), map = {}, used = {}, out = [];
    arr.forEach(function (e) { map[e.label] = e; });
    (labels || []).forEach(function (l) { if (map[l] && !used[l]) { out.push(map[l]); used[l] = true; } });
    arr.forEach(function (e) { if (!used[e.label]) out.push(e); });
    writeSaved(out);
    return out;
  }
  function compareLabels(a, b) { return String(a).localeCompare(String(b), 'ko', { numeric: true, sensitivity: 'base' }); }
  function sortSaved() {
    var arr = listSaved().sort(function (a, b) { return compareLabels(a.label, b.label); });
    writeSaved(arr);
    return arr;
  }

  var api = {
    KEY: KEY, DEFAULT_OPTIONS: DEFAULT_OPTIONS, newSession: newSession, hydrate: hydrate, load: load, get: get, update: update,
    undo: undo, canUndo: canUndo, reset: reset, wipeAll: wipeAll, replace: replace, onChange: onChange, persistNow: persistNow,
    exportJSON: exportJSON, importJSON: importJSON,
    STATUS_LABEL: STATUS_LABEL, isActive: isActive, activeStudents: activeStudents, inactiveStudents: inactiveStudents,
    listSaved: listSaved, saveAs: saveAs, loadSaved: loadSaved, deleteSaved: deleteSaved, getSaved: getSaved, putSaved: putSaved,
    moveSaved: moveSaved, sortSaved: sortSaved, reorderSaved: reorderSaved, compareLabels: compareLabels,
    rememberResult: rememberResult, pastTeams: pastTeams, HISTORY_MAX: HISTORY_MAX
  };
  root.AgoraState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
