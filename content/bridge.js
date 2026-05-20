(function () {
  'use strict';

  var buildId = window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId;
  if (!buildId) return;

  window.addEventListener('__fw_request_page_data', function (e) {
    var pathname = e.detail;
    if (!pathname) return;
    var url = '/_next/data/' + buildId + pathname.replace(/\/$/, '') + '.json';
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        window.dispatchEvent(
          new CustomEvent('__fw_page_data_response', { detail: JSON.stringify(data) })
        );
      })
      .catch(function () {});
  });
})();
