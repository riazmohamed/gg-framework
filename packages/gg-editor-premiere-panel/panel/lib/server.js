/* eslint-disable */
/**
 * Local HTTP server inside the CEP panel.
 *
 * Wire protocol — same as the macOS osascript bridge:
 *   POST /rpc
 *   { "method": "get_timeline", "params": {} }
 *   →
 *   { "ok": true, "result": {...} }
 *   { "ok": false, "error": "..." }
 *
 * Listens on 127.0.0.1 only — never exposed beyond localhost. The port is
 * fixed (default 7437) so the gg-editor adapter can find it without
 * discovery; override via env GG_EDITOR_PREMIERE_PORT before launching
 * Premiere.
 */
(function () {
  var http = cep_node ? cep_node.require("http") : null;
  if (!http) {
    setStatus("err", "no nodejs runtime — set --enable-nodejs in manifest");
    return;
  }

  var DEFAULT_PORT = 7437;
  var port = parseInt(
    (cep_node.process && cep_node.process.env && cep_node.process.env.GG_EDITOR_PREMIERE_PORT) ||
      DEFAULT_PORT,
    10,
  );

  var cs = new CSInterface();
  var reqCount = 0;

  function setStatus(kind, label) {
    var el = document.getElementById("status");
    if (!el) return;
    el.textContent = label;
    el.className = "pill " + (kind || "");
  }
  function setPort(p) {
    var el = document.getElementById("port");
    if (el) el.textContent = String(p);
  }
  function bumpReqs() {
    reqCount += 1;
    var el = document.getElementById("reqs");
    if (el) el.textContent = String(reqCount);
  }
  function setLastErr(msg) {
    var el = document.getElementById("lastErr");
    if (!el) return;
    el.textContent = msg || "—";
    el.className = msg ? "err" : "muted";
  }

  /**
   * JSX is loaded automatically by CEP via manifest <ScriptPath>. We invoke
   * named functions defined there: gg_ping, gg_get_timeline, etc.
   */
  function callJsx(method, params) {
    return new Promise(function (resolve) {
      var fn = "gg_" + method;
      // Stringify params safely for embedding in a JSX call.
      var jsonParams = JSON.stringify(params || {})
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
      var script = fn + '("' + jsonParams + '")';
      cs.evalScript(script, function (raw) {
        if (typeof raw !== "string") {
          resolve({ ok: false, error: "evalScript returned non-string" });
          return;
        }
        if (raw === "EvalScript error.") {
          resolve({ ok: false, error: "JSX evalScript error (method=" + method + ")" });
          return;
        }
        try {
          var parsed = JSON.parse(raw);
          resolve(parsed);
        } catch (e) {
          resolve({ ok: false, error: "JSX returned non-JSON: " + String(raw).slice(0, 200) });
        }
      });
    });
  }

  function readBody(req) {
    return new Promise(function (resolve, reject) {
      var chunks = [];
      req.on("data", function (c) { chunks.push(c); });
      req.on("end", function () {
        try { resolve(Buffer.concat(chunks).toString("utf8")); }
        catch (e) { reject(e); }
      });
      req.on("error", reject);
    });
  }

  var server = http.createServer(function (req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, product: "gg-editor-premiere-panel", port: port }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/rpc") {
      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, error: "POST /rpc only" }));
      return;
    }

    bumpReqs();
    readBody(req)
      .then(function (body) {
        var msg;
        try { msg = JSON.parse(body); }
        catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "bad json" }));
          return null;
        }
        if (!msg || typeof msg.method !== "string") {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "missing method" }));
          return null;
        }
        return callJsx(msg.method, msg.params || {}).then(function (result) {
          res.writeHead(200);
          res.end(JSON.stringify(result));
        });
      })
      .catch(function (err) {
        setLastErr(String(err && err.message ? err.message : err));
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      });
  });

  server.listen(port, "127.0.0.1", function () {
    setStatus("ok", "listening");
    setPort(port);
  });

  server.on("error", function (err) {
    setStatus("err", "bind failed");
    setLastErr(err.code === "EADDRINUSE" ? "port " + port + " already in use" : String(err));
  });
})();
