/* eslint-disable */
/**
 * Minimal CSInterface stub. Adobe ships a much larger CSInterface.js with
 * dozens of helpers; we only need evalScript() to run JSX in the host. The
 * extension API global `__adobe_cep__` is provided by the CEF runtime.
 */
(function (global) {
  function CSInterface() {}

  CSInterface.prototype.evalScript = function (script, callback) {
    var cb = callback || function () {};
    if (typeof global.__adobe_cep__ !== "undefined" && global.__adobe_cep__.evalScript) {
      global.__adobe_cep__.evalScript(script, cb);
    } else {
      // Outside the CEP host (browser dev): no-op.
      setTimeout(function () {
        cb("CSInterface not available outside CEP host");
      }, 0);
    }
  };

  CSInterface.prototype.getHostEnvironment = function () {
    if (typeof global.__adobe_cep__ !== "undefined" && global.__adobe_cep__.getHostEnvironment) {
      try { return JSON.parse(global.__adobe_cep__.getHostEnvironment()); }
      catch (_) { return {}; }
    }
    return {};
  };

  global.CSInterface = CSInterface;
})(this);
