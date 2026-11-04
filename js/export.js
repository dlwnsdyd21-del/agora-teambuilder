/* ============================================================
 * export.js — xlsx 내보내기, 텍스트 다운로드, 인쇄
 * ============================================================ */
(function (root) {
  'use strict';

  var Q = root.AgoraQuestions;
  var VK = Q.VIRTUE_KEYS;

  function r2(x) { return (typeof x === 'number' && isFinite(x)) ? Math.round(x * 100) / 100 : ''; }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }
  function safeName(s) { return String(s || '').replace(/[\\\/:*?"<>|]/g, '_').trim(); }
  /* ISO 시각 → 현지 시각 "2026-11-02 09:49" / 날짜만 "2026-11-02" */
  function localTime(iso, dateOnly) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d.getTime())) return String(iso).slice(0, dateOnly ? 10 : 16);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var s = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    return dateOnly ? s : s + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function downloadBlob(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }
  function downloadText(filename, text, mime) {
    downloadBlob(filename, new Blob(['﻿' + text], { type: (mime || 'text/plain') + ';charset=utf-8' }));
  }

  /*
   * session: 세션, prepared: 점수 계산된 학생 배열, stats: evaluateTeams 결과, teams: [[ids]]
   * opts.includeScores: 교사용 개인 점수 시트 포함 여부
   */
  function exportTeamsXlsx(session, prepared, teams, stats, opts) {
    var XLSX = root.XLSX;
    if (!XLSX) throw new Error('엑셀 라이브러리(SheetJS)를 불러오지 못했습니다.');
    opts = opts || {};
    var byId = {};
    prepared.forEach(function (s) { byId[s.id] = s; });
    var A = root.AgoraAlgorithm;
    var split = opts.split || (session.result && session.result.split) || null;
    var teamName = function (t) { return (opts.teamNames && opts.teamNames[t]) || (A ? A.teamLabel(t, split) : (t + 1) + '팀'); };
    /* 게시용 시트는 번호순 — 체력 순서가 드러나지 않도록 */
    var byNo = function (ids) {
      return ids.slice().sort(function (a, b) {
        var x = byId[a] && byId[a].no !== null && byId[a].no !== undefined ? byId[a].no : 1e9;
        var y = byId[b] && byId[b].no !== null && byId[b].no !== undefined ? byId[b].no : 1e9;
        return x - y;
      });
    };
    var pubTeams = teams.map(byNo);
    var St = root.AgoraState;
    var inactive = (St && session.students) ? session.students.filter(function (s) { return !St.isActive(s); }) : [];
    var inactiveText = inactive.map(function (s) { return (s.no !== null && s.no !== undefined ? s.no + ' ' : '') + (s.name || '') + '(' + ((St.STATUS_LABEL || {})[s.status] || s.status) + ')'; }).join(', ');
    var titleRow = [(session.classLabel ? session.classLabel + ' 학급 ' : '') + '팀 명단', '편성 ' + (session.result && session.result.builtAt ? localTime(session.result.builtAt, true) : localTime(new Date().toISOString(), true)), '수업일:'];

    var wb = XLSX.utils.book_new();

    /* 1) 팀 명단 (게시용: 점수 없음, 번호순). 첫 줄에 학급·편성일·수업일 칸 */
    var roster = [titleRow, ['팀', '번호', '이름', '성별']];
    pubTeams.forEach(function (ids, t) {
      ids.forEach(function (id) {
        var s = byId[id]; if (!s) return;
        roster.push([teamName(t), s.no === null ? '' : s.no, s.name || '', s.gender || '']);
      });
    });
    if (inactive.length) { roster.push([]); roster.push(['불참·역할', inactiveText]); }
    var ws1 = XLSX.utils.aoa_to_sheet(roster);
    ws1['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws1, '팀 명단');

    /* 2) 팀별 가로 명단 (게시용, 번호순) */
    var maxLen = Math.max.apply(null, pubTeams.map(function (t) { return t.length; }).concat([0]));
    var wide = [pubTeams.map(function (_, t) { return teamName(t); })];
    for (var i = 0; i < maxLen; i++) {
      wide.push(pubTeams.map(function (ids) { var s = byId[ids[i]]; return s ? ((s.no !== null ? s.no + ' ' : '') + (s.name || '')) : ''; }));
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wide), '팀별 명단');

    /* 3) 균형표 (팀 단위 통계). 남녀 따로면 성별 그룹마다 블록 */
    if (stats) {
      var groups = (opts.groups && opts.groups.length) ? opts.groups : [{ label: '', idx: teams.map(function (_, i) { return i; }), stats: stats }];
      var bal = [];
      groups.forEach(function (g) {
        if (g.label) bal.push([g.label + ' (같은 성별 안에서 비교)']);
        bal.push(['팀', '인원', '남', '여', 'PAPS 평균(100점 만점)'].concat(VK.map(function (k) { return k + ' 평균(5점 만점)'; })));
        g.stats.teams.forEach(function (tm, j) {
          bal.push([teamName(g.idx[j]), tm.size, tm.male, tm.female, r2(tm.meanPaps)].concat(VK.map(function (k) { return r2(tm.meanVirtues[k]); })));
        });
        bal.push(['팀 평균 범위(최대-최소)', '', '', '', r2(g.stats.metrics.PAPS.range)].concat(VK.map(function (k) { return r2(g.stats.metrics[k].range); })));
        bal.push(['팀 평균 표준편차', '', '', '', r2(g.stats.metrics.PAPS.sd)].concat(VK.map(function (k) { return r2(g.stats.metrics[k].sd); })));
        bal.push(['학생 표준편차', '', '', '', r2(g.stats.metrics.PAPS.studentSd)].concat(VK.map(function (k) { return r2(g.stats.metrics[k].studentSd); })));
        if (g.label) bal.push([g.label + ' 공정성 점수', g.stats.equity]);
        bal.push([]);
      });
      bal.push(['공정성 점수', opts.equity !== undefined ? opts.equity : stats.equity]);
      if (split) bal.push(['편성 단위', '남녀 따로 (남자 팀 ' + split['남'] + '개 · 여자 팀 ' + split['여'] + '개)']);
      var impP = prepared.filter(function (s) { return s.papsImputed; }).length, impV = prepared.filter(function (s) { return s.virtueImputed; }).length;
      bal.push(['결측 대체(학급 평균으로 채움)', 'PAPS ' + impP + '명 · 인성 ' + impV + '명']);
      bal.push(['편성 시드', session.result ? session.result.seed : '']);
      bal.push(['PAPS 허용편차(점)', session.options.papsTolerance]);
      bal.push(['PAPS 점수 기준', root.AgoraPapsTable ? root.AgoraPapsTable.SOURCE : '']);
      bal.push(['성별 균형', session.options.genderBalance ? '켬' : '끔']);
      bal.push(['학급', session.classLabel || '']);
      bal.push(['편성 일시', session.result ? localTime(session.result.builtAt) : '']);
      bal.push(['편성 방식', session.result ? ({ auto: '교사 편성', pick: '팀별 드래프트', credit: '크레딧 드래프트' }[session.result.mode] || (session.result.source === 'draft' ? '드래프트' : '자동')) : '']);
      bal.push(['수동 조정', session.manualEdits ? '있음' : '없음']);
      bal.push(['수정 메모', session.result && session.result.note ? session.result.note : '']);
      bal.push(['불참·역할(편성 제외)', inactiveText]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bal), '균형표');
    }

    /* 4) 교사용 개인 점수 (선택) */
    if (opts.includeScores) {
      var itemKeys = ['run', 'flex', 'situp', 'pushup', 'grip', 'jump', 'run50', 'bmi'];
      var T = root.AgoraPapsTable;
      var sc = [['팀', '번호', '이름', '성별', 'PAPS 총점', 'PAPS 등급', 'PAPS 산출'].concat(itemKeys.map(function (k) { return T.ITEMS[k].label + ' 점수'; })).concat(VK).concat(['PAPS 대체', '인성 대체', 'PAPS 자료', '설문 자료'])];
      teams.forEach(function (ids, t) {
        ids.forEach(function (id) {
          var s = byId[id]; if (!s) return;
          var d = s.papsDetail || {};
          var srcLabel = { neis: '나이스 점수', official: '공식 기준표', relative: '학급 내 상대', given: '총점 입력', grade: '등급 입력' }[d.source] || '';
          sc.push([teamName(t), s.no === null ? '' : s.no, s.name || '', s.gender || '', r2(s.papsPoints), s.papsGrade || '', srcLabel + (d.scaled ? '(환산)' : '')]
            .concat(itemKeys.map(function (k) { return d.items && d.items[k] ? d.items[k].points : ''; }))
            .concat(VK.map(function (k) { return r2(s.virtues[k]); }))
            .concat([s.papsImputed ? 'Y' : '', s.virtueImputed ? 'Y' : '', s.source && s.source.paps ? 'Y' : '', s.source && s.source.survey ? 'Y' : '']));
        });
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sc), '교사용 개인점수');
    }

    var fname = safeName((session.classLabel ? session.classLabel + '_' : '') + '팀편성_' + stamp()) + '.xlsx';
    XLSX.writeFile(wb, fname);
    return fname;
  }

  /*
   * 저장된 모든 학급의 팀 명단을 한 파일로 (반마다 시트 하나: 게시용 명단 + 팀 단위 균형)
   * entries: AgoraState.listSaved() 결과. 편성 결과가 있는 학급만 포함. 반환 {fname, count, skipped:[label]}
   */
  function exportAllClassesXlsx(entries) {
    var XLSX = root.XLSX, S = root.AgoraScoring, A = root.AgoraAlgorithm, St = root.AgoraState;
    if (!XLSX) throw new Error('엑셀 라이브러리(SheetJS)를 불러오지 못했습니다.');
    var wb = XLSX.utils.book_new(), count = 0, skipped = [];
    var summary = [['학급', '학생(참여)', '불참', '팀 수', '공정성', '편성 일시', '편성 방식', '수동 조정']];
    (entries || []).forEach(function (e) {
      var ses = St.hydrate(e.session);
      if (!ses.result || !Array.isArray(ses.result.teams)) { skipped.push(e.label); return; }
      var active = St.activeStudents(ses);
      var prepared = S.prepareStudents(active, ses.options);
      var byId = {}; prepared.forEach(function (p) { byId[p.id] = p; });
      var seen = {};
      var teams = ses.result.teams.map(function (t) { return t.filter(function (id) { if (!byId[id] || seen[id]) return false; seen[id] = true; return true; }); });
      var ev = A.evaluateGroups(prepared, teams, ses.result.split || null);
      var stats = { equity: ev.equity, teams: [] };
      ev.groups.forEach(function (g) { g.stats.teams.forEach(function (tm) { stats.teams.push(tm); }); });
      var tn = function (t) { return (ses.teamNames && ses.teamNames[t]) || A.teamLabel(t, ses.result.split || null); };
      var rows = [[e.label + ' 학급 팀 명단', '편성 ' + localTime(ses.result.builtAt, true), '수업일:'], ['팀', '번호', '이름', '성별']];
      teams.forEach(function (ids, t) {
        ids.slice().sort(function (a, b) { return (byId[a].no === null ? 1e9 : byId[a].no) - (byId[b].no === null ? 1e9 : byId[b].no); })
          .forEach(function (id) { var s = byId[id]; rows.push([tn(t), s.no === null ? '' : s.no, s.name || '', s.gender || '']); });
      });
      var inactive = St.inactiveStudents(ses);
      if (inactive.length) { rows.push([]); rows.push(['불참·역할', inactive.map(function (s) { return (s.no !== null ? s.no + ' ' : '') + (s.name || '') + '(' + (St.STATUS_LABEL[s.status] || s.status) + ')'; }).join(', ')]); }
      rows.push([]); rows.push(['팀', '인원', '남', '여', 'PAPS 평균'].concat(VK.map(function (k) { return k; })));
      stats.teams.forEach(function (tm, t) { rows.push([tn(t), tm.size, tm.male, tm.female, r2(tm.meanPaps)].concat(VK.map(function (k) { return r2(tm.meanVirtues[k]); }))); });
      rows.push(['공정성 점수', stats.equity]);
      var ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, ws, safeName(e.label).slice(0, 28) || ('학급' + (count + 1)));
      summary.push([e.label, prepared.length, inactive.length, teams.length, stats.equity, localTime(ses.result.builtAt), { auto: '교사 편성', pick: '팀별 드래프트', credit: '크레딧 드래프트' }[ses.result.mode] || (ses.result.source === 'draft' ? '드래프트' : '자동'), ses.manualEdits ? '있음' : '']);
      count++;
    });
    if (!count) throw new Error('편성 결과가 저장된 학급이 없습니다. 각 학급에서 편성을 마치고 "학급 저장"을 눌러 주세요.');
    var wsS = XLSX.utils.aoa_to_sheet(summary);
    XLSX.utils.book_append_sheet(wb, wsS, '학급별 요약');
    wb.SheetNames.unshift(wb.SheetNames.pop());   // 요약 시트를 맨 앞으로
    var fname = safeName('전체학급_팀편성_' + stamp()) + '.xlsx';
    XLSX.writeFile(wb, fname);
    return { fname: fname, count: count, skipped: skipped };
  }

  function exportSessionJSON(session) {
    var fname = safeName((session.classLabel ? session.classLabel + '_' : '') + '팀편성세션_' + stamp()) + '.json';
    downloadText(fname, root.AgoraState.exportJSON(), 'application/json');
    return fname;
  }

  /* 빈 양식 다운로드 (교사가 직접 채우는 용도) */
  function exportTemplateXlsx(kind) {
    var XLSX = root.XLSX;
    if (!XLSX) throw new Error('엑셀 라이브러리(SheetJS)를 불러오지 못했습니다.');
    var wb = XLSX.utils.book_new();
    var rows;
    if (kind === 'survey') {
      rows = [['번호', '이름', '성별'].concat(Array.from({ length: 32 }, function (_, i) { return String(i + 1); }))];
      for (var i = 1; i <= 30; i++) rows.push([i, '', '']);
    } else if (kind === 'virtues') {
      rows = [['번호', '이름', '성별', '성실', '협동', '정의', '배려']];
      for (var j = 1; j <= 30; j++) rows.push([j, '', '', '', '', '', '']);
    } else {
      rows = [['번호', '이름', '성별', 'PAPS 총점']];
      for (var k = 1; k <= 30; k++) rows.push([k, '', '', '']);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '입력');
    var fname = { survey: '인성설문_32문항_양식.xlsx', virtues: '인성_4덕목_양식.xlsx', paps: 'PAPS_총점_양식.xlsx' }[kind] || '양식.xlsx';
    XLSX.writeFile(wb, fname);
  }

  function printPage() { root.print(); }

  var api = { exportTeamsXlsx: exportTeamsXlsx, exportAllClassesXlsx: exportAllClassesXlsx, exportSessionJSON: exportSessionJSON, exportTemplateXlsx: exportTemplateXlsx, downloadText: downloadText, printPage: printPage, localTime: localTime };
  root.AgoraExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
