/* app.js — 부트스트랩 */
(function () {
  'use strict';
  function start() {
    try {
      window.AgoraState.load();
      window.AgoraUI.init();
    } catch (e) {
      console.error(e);
      var el = document.createElement('div');
      el.className = 'log';
      el.textContent = '앱을 시작하지 못했습니다: ' + (e && e.message);
      document.body.insertBefore(el, document.body.firstChild);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
