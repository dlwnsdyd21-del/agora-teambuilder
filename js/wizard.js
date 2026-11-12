/* ============================================================
 * wizard.js — 단계별 화면 (한 번에 한 단계만 보이고, 이전/다음으로 이동)
 *  - 상단 단계 표시줄(누르면 이동) + 단계마다 안내 상자 + 아래 이전/다음 버튼
 *  - "한 페이지로 보기"를 켜면 예전처럼 모든 단계를 한 화면에
 *  - 편성 화면에서 저장하면(#sec-result 또는 결과 갱신) 4단계로 자동 이동
 * ============================================================ */
(function (root) {
  'use strict';

  var St = root.AgoraState;
  var STEP_KEY = 'agora.ui.step', ONEPAGE_KEY = 'agora.ui.onepage';
  var STEPS = [
    { id: 'sec-import', title: '자료 올리기', short: '자료',
      guide: ['인성 설문(구글폼 응답) 파일과 나이스 팝스 파일을 아래 두 칸에 올리세요.', '어느 파일을 먼저 올려도 됩니다. 두 파일이 다 들어가면 아래 "다음"을 누르세요.'] },
    { id: 'sec-roster', title: '명단 확인', short: '명단',
      guide: ['학생 이름과 성별을 확인하세요. 성별은 남·여 버튼을 한 번 누르면 되고, 한쪽 성별만 먼저 누른 뒤 표 아래 "빈칸 모두 남/여"로 나머지를 한 번에 채울 수 있습니다. "추정"이라고 표시된 성별은 맞는지 확인해 주세요.', '오늘 빠진 학생은 맨 오른쪽 "참여" 칸을 결석·기록/심판 등으로 바꾸면 편성에서 빠집니다.'] },
    { id: 'sec-settings', title: '편성하기', short: '편성',
      guide: ['팀 수와 편성 방식을 고른 뒤 "편성 화면 열기"를 누르세요.', '새 창에서 편성을 마치고 "완료 · 저장"을 누르면 자동으로 다음 단계(결과)로 넘어옵니다.'] },
    { id: 'sec-result', title: '결과 확인', short: '결과',
      guide: ['팀 구성과 팀 균형을 확인하세요. 학생을 다른 팀으로 끌어다 옮길 수도 있습니다.', '학생들에게 화면을 보여줄 때는 위쪽 "학생용 보기"를 켜면 개인 점수가 숨겨집니다.'] },
    { id: 'sec-export', title: '인쇄하기', short: '인쇄',
      guide: ['"팀 명단 인쇄"를 누르면 미리보기가 열립니다. 용지 방향·제목을 고른 뒤 바로 인쇄하세요.', '게시용 명단에는 개인 점수가 들어가지 않습니다. 팀마다 한 장씩 뽑거나 교사용(점수 포함)으로도 인쇄할 수 있습니다.'] }
  ];

  var cur = 0, lastBuiltAt = null, built = false;

  function $(sel) { return document.querySelector(sel); }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c === null || c === undefined) continue; el.appendChild(c instanceof Node ? c : document.createTextNode(String(c))); }
    return el;
  }
  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function set(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* ignore */ } }

  function onePage() { return get(ONEPAGE_KEY) === '1'; }
  function isOn() { return !onePage(); }

  /* 각 단계의 준비 상태: {ok, text} — 다음 버튼과 상태 문구에 사용 */
  function status(i) {
    var s = St.get();
    var n = s.students.length;
    var pap = s.students.filter(function (x) { return x.source && x.source.paps; }).length;
    var sur = s.students.filter(function (x) { return x.source && x.source.survey; }).length;
    if (i === 0) {
      if (!n) return { ok: false, text: '아직 올린 파일이 없습니다. 위에 파일을 올려 주세요.' };
      var parts = [(sur ? '✔ 인성 설문 ' + sur + '명' : '✖ 인성 설문 아직 없음'), (pap ? '✔ 팝스 ' + pap + '명' : '✖ 팝스 아직 없음')];
      return { ok: true, ready: !!(sur && pap), text: parts.join('   ') + (sur && pap ? ' — 준비 완료!' : ' — 나머지 파일도 올리면 더 정확합니다.') };
    }
    if (i === 1) {
      var noG = s.students.filter(function (x) { return !x.gender; }).length;
      var inf = s.students.filter(function (x) { return x.gender && x.genderInferred; }).length;
      return { ok: n > 0, ready: n > 0 && !noG, text: n ? ('학생 ' + n + '명' + (noG ? ' · ⚠ 성별 빈칸 ' + noG + '명' : '') + (inf ? ' · 성별 추정 ' + inf + '명 (확인 권장)' : '') + (noG ? '' : ' — 다음으로 넘어가도 됩니다.')) : '1단계에서 자료를 먼저 올려 주세요.' };
    }
    if (i === 2) {
      var has = !!(s.result && s.result.teams && s.result.teams.length);
      return { ok: has, ready: has, text: has ? '✔ 편성 결과가 있습니다. "다음"을 누르면 결과를 볼 수 있습니다.' : '"편성 화면 열기"로 편성을 마치면 결과로 넘어갈 수 있습니다.' };
    }
    if (i === 3) {
      var hasR = !!(s.result && s.result.teams && s.result.teams.length);
      return { ok: hasR, ready: hasR, text: hasR ? '결과를 확인했으면 "다음"에서 명단을 인쇄하세요.' : '아직 편성 결과가 없습니다. 3단계에서 편성해 주세요.' };
    }
    return { ok: true, text: '' };
  }

  function go(i, noScroll) {
    cur = Math.max(0, Math.min(STEPS.length - 1, i));
    set(STEP_KEY, String(cur));
    apply();
    if (!noScroll) root.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function apply() {
    var on = isOn();
    document.body.classList.toggle('wizard', on);
    STEPS.forEach(function (st, i) {
      var sec = document.getElementById(st.id);
      if (sec) sec.classList.toggle('step-active', i === cur);
    });
    renderStepper();
    renderNavs();
  }

  function renderStepper() {
    var nav = $('nav.steps');
    if (!nav) return;
    while (nav.firstChild) nav.removeChild(nav.firstChild);
    var on = isOn();
    var list = h('ol', { class: 'stepper' });
    STEPS.forEach(function (st, i) {
      var done = i < cur && status(i).ok;
      var cls = 'step' + (on && i === cur ? ' current' : '') + (done ? ' done' : '');
      list.appendChild(h('li', { class: cls },
        h('button', { type: 'button', title: (i + 1) + '단계: ' + st.title, onclick: function () { if (isOn()) go(i); else { var sec = document.getElementById(st.id); if (sec) sec.scrollIntoView({ behavior: 'smooth' }); } } },
          h('b', { text: done ? '✓' : String(i + 1) }), h('span', { class: 'lbl', text: st.title }))));
    });
    nav.appendChild(list);
    nav.appendChild(h('label', { class: 'onepage adv', title: '모든 단계를 한 화면에 이어서 보여 줍니다' },
      h('input', { type: 'checkbox', checked: !on, onchange: function (e) { set(ONEPAGE_KEY, e.target.checked ? '1' : '0'); apply(); } }), ' 한 페이지로 보기'));
  }

  /* 단계마다 안내 상자(위)와 이전/다음 버튼(아래) */
  function buildChrome() {
    STEPS.forEach(function (st, i) {
      var sec = document.getElementById(st.id);
      if (!sec) return;
      var guide = h('div', { class: 'step-guide' },
        h('div', { class: 'step-count', text: (i + 1) + ' / ' + STEPS.length + '단계' }),
        h('ol', null));
      st.guide.forEach(function (g) { guide.lastChild.appendChild(h('li', { text: g })); });
      var head = sec.querySelector('.sec-head') || sec.querySelector('h2');
      if (head && head.nextSibling) sec.insertBefore(guide, head.nextSibling); else sec.appendChild(guide);
      sec.appendChild(h('div', { class: 'step-nav no-print', 'data-step': i }));
    });
    built = true;
  }

  function renderNavs() {
    STEPS.forEach(function (st, i) {
      var sec = document.getElementById(st.id);
      var nav = sec && sec.querySelector('.step-nav');
      if (!nav) return;
      while (nav.firstChild) nav.removeChild(nav.firstChild);
      var stt = status(i);
      var prev = i > 0 ? h('button', { class: 'btn ghost big', type: 'button', onclick: function () { go(i - 1); } }, '◀ 이전: ' + STEPS[i - 1].title) : h('span');
      var next = null;
      if (i < STEPS.length - 1) {
        next = h('button', { class: 'btn primary big' + (stt.ready ? ' pulse' : ''), type: 'button', disabled: !stt.ok, onclick: function () { go(i + 1); } }, '다음: ' + STEPS[i + 1].title + ' ▶');
      } else {
        next = h('button', { class: 'btn big', type: 'button', onclick: function () { go(0); } }, '처음으로 ↺');
      }
      nav.appendChild(prev);
      nav.appendChild(h('div', { class: 'step-status' + (stt.ok ? '' : ' wait'), text: stt.text }));
      nav.appendChild(next);
    });
  }

  function stepOfHash() {
    var id = (location.hash || '').replace('#', '');
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return i;
    return -1;
  }

  function onState(s) {
    if (!built) return;
    /* 편성 화면에서 새 결과가 저장되면 결과 단계로 */
    var b = s.result && s.result.builtAt;
    if (b && b !== lastBuiltAt && isOn() && cur <= 2) { lastBuiltAt = b; go(3); return; }
    lastBuiltAt = b || null;
    renderStepper(); renderNavs();
  }

  function init() {
    if (!St || !document.getElementById('sec-import')) return;
    buildChrome();
    var s = St.get();
    lastBuiltAt = (s.result && s.result.builtAt) || null;
    var saved = parseInt(get(STEP_KEY), 10);
    var hs = stepOfHash();
    cur = hs >= 0 ? hs : (!isNaN(saved) ? saved : 0);
    if (!s.students.length) cur = 0;
    apply();
    St.onChange(onState);
    root.addEventListener('hashchange', function () { var k = stepOfHash(); if (k >= 0 && isOn()) go(k, true); });
    /* 다른 창(편성 화면)에서 저장 → 메인 화면이 상태를 다시 읽은 뒤 결과 단계로 이동 */
    root.addEventListener('storage', function (e) { if (e.key === St.KEY) setTimeout(function () { onState(St.get()); }, 50); });
  }

  root.AgoraWizard = { init: init, go: go, isOn: isOn, current: function () { return cur; }, refresh: function () { if (built) { renderStepper(); renderNavs(); } } };
})(window);
