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
    draftMode: 'auto', creditFitnessWeight: 0.6, draftTimerSec: 0, draftAnonymous: true
  };

  function newSession() {
    return {
      version: 1, classLabel: '', updatedAt: null,
      students: [],
      options: JSON.parse(JSON.stringify(DEFAULT_OPTIONS)),
      imports: { paps: null, survey: null },   // {fileName, sheetName, rowCount, mappingSummary}
      result: null,                            // {teams:[[ids]], seed, log, builtAt, source?: 'auto'|'draft', mode?}
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
    return s;
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
  function deleteSaved(label) {
    writeSaved(listSaved().filter(function (x) { return x.label !== label; }));
  }

  var api = {
    KEY: KEY, DEFAULT_OPTIONS: DEFAULT_OPTIONS, newSession: newSession, load: load, get: get, update: update,
    undo: undo, canUndo: canUndo, reset: reset, replace: replace, onChange: onChange, persistNow: persistNow,
    exportJSON: exportJSON, importJSON: importJSON,
    listSaved: listSaved, saveAs: saveAs, loadSaved: loadSaved, deleteSaved: deleteSaved
  };
  root.AgoraState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
