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
    var teamName = function (t) { return (opts.teamNames && opts.teamNames[t]) || (t + 1) + '팀'; };

    var wb = XLSX.utils.book_new();

    /* 1) 팀 명단 (게시용: 점수 없음) */
    var roster = [['팀', '번호', '이름', '성별']];
    teams.forEach(function (ids, t) {
      ids.forEach(function (id) {
        var s = byId[id]; if (!s) return;
        roster.push([teamName(t), s.no === null ? '' : s.no, s.name || '', s.gender || '']);
      });
    });
    var ws1 = XLSX.utils.aoa_to_sheet(roster);
    ws1['!cols'] = [{ wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 6 }];
    XLSX.utils.book_append_sheet(wb, ws1, '팀 명단');

    /* 2) 팀별 가로 명단 (게시용) */
    var maxLen = Math.max.apply(null, teams.map(function (t) { return t.length; }).concat([0]));
    var wide = [teams.map(function (_, t) { return teamName(t); })];
    for (var i = 0; i < maxLen; i++) {
      wide.push(teams.map(function (ids) { var s = byId[ids[i]]; return s ? ((s.no !== null ? s.no + ' ' : '') + (s.name || '')) : ''; }));
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wide), '팀별 명단');

    /* 3) 균형표 (팀 단위 통계) */
    if (stats) {
      var bal = [['팀', '인원', '남', '여', 'PAPS 평균(z)'].concat(VK.map(function (k) { return k + ' 평균'; }))];
      stats.teams.forEach(function (tm, t) {
        bal.push([teamName(t), tm.size, tm.male, tm.female, r2(tm.meanPaps)].concat(VK.map(function (k) { return r2(tm.meanVirtues[k]); })));
      });
      bal.push([]);
      bal.push(['팀 평균 범위(최대-최소)', '', '', '', r2(stats.metrics.PAPS.range)].concat(VK.map(function (k) { return r2(stats.metrics[k].range); })));
      bal.push(['팀 평균 표준편차', '', '', '', r2(stats.metrics.PAPS.sd)].concat(VK.map(function (k) { return r2(stats.metrics[k].sd); })));
      bal.push(['학생 표준편차', '', '', '', r2(stats.metrics.PAPS.studentSd)].concat(VK.map(function (k) { return r2(stats.metrics[k].studentSd); })));
      bal.push([]);
      bal.push(['공정성 점수', stats.equity]);
      bal.push(['편성 시드', session.result ? session.result.seed : '']);
      bal.push(['PAPS 허용편차(τ)', session.options.papsTolerance]);
      bal.push(['성별 균형', session.options.genderBalance ? '켬' : '끔']);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bal), '균형표');
    }

    /* 4) 교사용 개인 점수 (선택) */
    if (opts.includeScores) {
      var sc = [['팀', '번호', '이름', '성별', 'PAPS z', 'PAPS 대체'].concat(VK).concat(['인성 대체', 'PAPS 자료', '설문 자료'])];
      teams.forEach(function (ids, t) {
        ids.forEach(function (id) {
          var s = byId[id]; if (!s) return;
          sc.push([teamName(t), s.no === null ? '' : s.no, s.name || '', s.gender || '', r2(s.papsZ), s.papsImputed ? 'Y' : '']
            .concat(VK.map(function (k) { return r2(s.virtues[k]); }))
            .concat([s.virtueImputed ? 'Y' : '', s.source && s.source.paps ? 'Y' : '', s.source && s.source.survey ? 'Y' : '']));
        });
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sc), '교사용 개인점수');
    }

    var fname = safeName((session.classLabel ? session.classLabel + '_' : '') + '팀편성_' + stamp()) + '.xlsx';
    XLSX.writeFile(wb, fname);
    return fname;
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

  var api = { exportTeamsXlsx: exportTeamsXlsx, exportSessionJSON: exportSessionJSON, exportTemplateXlsx: exportTemplateXlsx, downloadText: downloadText, printPage: printPage };
  root.AgoraExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
