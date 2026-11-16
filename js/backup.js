/* ============================================================
 * backup.js — 백업 파일 만들기 / 가져오기 (다른 컴퓨터로 옮기기)
 *   비밀번호를 정하면 AES-GCM(256)으로 암호화 (열쇠: PBKDF2-SHA256 25만 회)
 * ============================================================ */
(function (root) {
  'use strict';

  var St = root.AgoraState, X = root.AgoraExport;
  var ENC_TYPE = 'backup-encrypted', ITER = 250000;

  function $(sel) { return document.querySelector(sel); }
  /* 대화상자가 열려 있으면 그 안에(모달 위에 뜨는 대화상자가 아래쪽 알림을 가리므로), 아니면 화면 아래 알림으로 */
  function toast(msg, isError) {
    var dlg = $('#backup-dlg'), m = $('#bk-msg');
    if (dlg && dlg.open && m) { m.textContent = msg; m.hidden = false; m.classList.toggle('error', !!isError); try { m.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ } return; }
    var el = $('#toast'); if (!el) { alert(msg); return; }
    el.textContent = msg; el.hidden = false; el.classList.toggle('error', !!isError);
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, isError ? 4500 : 3000);
  }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- 암호화 ---------- */
  function b64(bytes) { var s = ''; bytes = new Uint8Array(bytes); for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(str) { var s = atob(str), out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  function cryptoOk() { return !!(root.crypto && root.crypto.subtle); }
  function deriveKey(pw, salt, iter) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function encrypt(text, pw) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(pw, salt, ITER).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text));
    }).then(function (ct) {
      return { app: 'agora-teambuilder', type: ENC_TYPE, version: 1, createdAt: new Date().toISOString(),
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITER, salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv) }, data: b64(ct) };
    });
  }
  function decrypt(obj, pw) {
    return deriveKey(pw, unb64(obj.kdf.salt), obj.kdf.iterations || ITER).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.cipher.iv) }, key, unb64(obj.data));
    }).then(function (buf) { return new TextDecoder().decode(buf); }, function () { throw new Error('비밀번호가 맞지 않습니다.'); });
  }

  /* ---------- 대화상자 ---------- */
  var pendingFile = null;   // 비밀번호를 기다리는 암호화 백업

  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }
  function localSummary() {
    var s = St.get(), saved = St.listSaved(), labels = saved.map(function (e) { return e.label; }), n = 0;
    saved.forEach(function (e) { n += ((e.session && e.session.students) || []).length; });
    if (s.students.length && !(s.classLabel && labels.indexOf(s.classLabel) >= 0)) { labels.push((s.classLabel || '이름 없는 학급') + ' (현재 화면)'); n += s.students.length; }
    return { labels: labels, students: n };
  }
  function open() {
    var dlg = $('#backup-dlg');
    var sm = localSummary();
    $('#bk-summary').innerHTML = sm.labels.length
      ? '학급 <b>' + sm.labels.length + '개</b> · 학생 <b>' + sm.students + '명</b>: ' + sm.labels.map(esc).join(', ')
      : '이 컴퓨터에는 아직 저장된 자료가 없습니다.';
    $('#bk-make').disabled = !sm.labels.length;
    $('#bk-pw').value = ''; $('#bk-pw2').value = '';
    resetImport();
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  }
  function close() { var dlg = $('#backup-dlg'); if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  function resetImport() {
    pendingFile = null;
    $('#bk-msg').hidden = true;
    $('#bk-unlock').hidden = true; $('#bk-open-pw').value = '';
    $('#bk-preview').hidden = true; $('#bk-preview').innerHTML = '';
  }

  function make() {
    var pw = $('#bk-pw').value, pw2 = $('#bk-pw2').value;
    if (pw !== pw2) { toast('비밀번호 두 칸이 서로 다릅니다.', true); $('#bk-pw2').focus(); return; }
    if (pw && pw.length < 4) { toast('비밀번호는 4자 이상으로 정해 주세요.', true); $('#bk-pw').focus(); return; }
    if (pw && !cryptoOk()) { toast('이 브라우저에서는 암호화를 쓸 수 없습니다. Chrome·Edge 최신판에서 열어 주세요.', true); return; }
    var bk = St.makeBackup();
    var fname = '팀빌딩_백업_' + stamp() + (pw ? '_암호' : '') + '.json';
    var btn = $('#bk-make'); btn.disabled = true;
    var done = function (obj) {
      X.downloadText(fname, JSON.stringify(obj), 'application/json');
      btn.disabled = false;
      toast(fname + ' 저장 — 다른 컴퓨터에서 "💾 백업 · 옮기기 → 가져오기"로 여세요.');
    };
    if (pw) encrypt(JSON.stringify(bk), pw).then(done, function (e) { btn.disabled = false; toast('암호화 실패: ' + e.message, true); });
    else done(bk);
  }

  function readFile(file) {
    if (!file) return;
    resetImport();
    var r = new FileReader();
    r.onload = function () {
      var obj;
      try { obj = JSON.parse(String(r.result).replace(/^﻿/, '')); }
      catch (e) { toast('파일을 읽지 못했습니다. 이 프로그램에서 만든 백업 파일(.json)인지 확인하세요.', true); return; }
      if (obj && obj.type === ENC_TYPE) {
        if (!cryptoOk()) { toast('이 브라우저에서는 암호를 풀 수 없습니다. Chrome·Edge 최신판에서 열어 주세요.', true); return; }
        pendingFile = obj;
        $('#bk-unlock').hidden = false; $('#bk-open-pw').focus();
        return;
      }
      accept(obj);
    };
    r.onerror = function () { toast('파일을 읽지 못했습니다.', true); };
    r.readAsText(file, 'utf-8');
  }
  function unlock() {
    if (!pendingFile) return;
    var pw = $('#bk-open-pw').value;
    if (!pw) { $('#bk-open-pw').focus(); return; }
    $('#bk-open').disabled = true;
    decrypt(pendingFile, pw).then(function (text) {
      $('#bk-open').disabled = false;
      accept(JSON.parse(text));
    }, function (e) { $('#bk-open').disabled = false; toast(e.message, true); $('#bk-open-pw').select(); });
  }
  /* 겹치는 학급이 없으면 바로 가져오고, 있으면 무엇이 바뀌는지 보여 준 뒤 확인 */
  function accept(obj) {
    var bk;
    try { bk = St.readBackup(obj); } catch (e) { toast(e.message, true); return; }
    $('#bk-unlock').hidden = true;
    var sm = St.backupSummary(bk);
    if (!sm.classes.length && !sm.currentUnsaved) { toast('백업 파일에 학급 자료가 없습니다.', true); return; }
    if (!sm.conflicts.length) { apply(bk); return; }
    var pv = $('#bk-preview');
    pv.innerHTML = '<p><b>이 컴퓨터에 같은 이름의 학급이 있습니다.</b> 가져오면 아래 학급은 <b>백업 파일 내용으로 바뀝니다</b>' +
      (sm.createdAt ? ' (백업 ' + esc(X.localTime(sm.createdAt)) + ')' : '') + '. 이 컴퓨터에만 있는 학급은 그대로 남습니다.</p>' +
      '<ul class="bk-list">' + sm.classes.map(function (c) {
        return '<li' + (c.exists ? ' class="over"' : '') + '><b>' + esc(c.label) + '</b> ' + c.count + '명' + (c.hasResult ? ' · 편성됨' : '') + (c.exists ? ' <span class="tag">덮어씀</span>' : ' <span class="tag new">새로 추가</span>') + '</li>';
      }).join('') + (sm.currentUnsaved ? '<li><b>' + esc(sm.currentLabel || '이름 없는 학급') + '</b> ' + bk.current.students.length + '명 <span class="tag new">지금 화면으로 열림</span></li>' : '') + '</ul>';
    var go = document.createElement('button');
    go.className = 'btn primary'; go.type = 'button'; go.textContent = '가져오기 (' + sm.conflicts.length + '개 학급 덮어쓰기)';
    go.addEventListener('click', function () { apply(bk); });
    var no = document.createElement('button');
    no.className = 'btn ghost'; no.type = 'button'; no.textContent = '취소';
    no.addEventListener('click', resetImport);
    var row = document.createElement('div'); row.className = 'row wrap'; row.appendChild(go); row.appendChild(no);
    pv.appendChild(row);
    pv.hidden = false;
  }
  function apply(bk) {
    var r = St.restoreBackup(bk);
    resetImport(); close();
    toast('백업을 가져왔습니다 — 학급 ' + r.classes + '개' + (r.current ? ' · 지금 화면: ' + r.current : '') + '. 상단 학급 전환에서 반을 고르세요.');
    if (root.AgoraUI && root.AgoraUI.render) root.AgoraUI.render();
  }

  function init() {
    var dlg = $('#backup-dlg'); if (!dlg) return;
    document.querySelectorAll('.btn-backup').forEach(function (b) { b.addEventListener('click', open); });
    $('#bk-close').addEventListener('click', close);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    $('#bk-make').addEventListener('click', make);
    $('#bk-file').addEventListener('change', function (e) { readFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    $('#bk-open').addEventListener('click', unlock);
    $('#bk-open-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); unlock(); } });
    var drop = $('#bk-drop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { readFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  root.AgoraBackup = { open: open, encrypt: encrypt, decrypt: decrypt };
})(window);
