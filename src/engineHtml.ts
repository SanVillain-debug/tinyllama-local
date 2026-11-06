/* Hidden WebView engine: llama.cpp compiled to WebAssembly (wllama), loaded from cdn.jsdelivr.net.
   Talks to the app only through JSON messages (see ToEngine / FromEngine in src/types.ts).
   The HTML is plain ES5-style script inside one string: no backticks and no dollar-brace sequences inside. */
export const ENGINE_HTML: string = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Motor local</title>
</head>
<body>
<script>
(function () {
  'use strict';

  var ENGINE_URL = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2/esm/';
  var MARKERS = ['<|user|>', '<|system|>', '<|assistant|>'];

  var lib = null;
  var wllama = null;
  var loading = false;
  var generating = false;
  var abortCtl = null;
  var userStopped = false;
  var queued = null;

  function send(obj) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    } catch (e) { /* the bridge is gone: nothing to do */ }
  }

  function friendlyError(e, fallback) {
    var raw = '';
    try { raw = String((e && e.message) || e || ''); } catch (x) { raw = ''; }
    var low = raw.toLowerCase();
    if (low.indexOf('memory') >= 0 || low.indexOf('alloc') >= 0 || low.indexOf('oom') >= 0 || low.indexOf('out of bounds') >= 0) {
      return 'Sin memoria suficiente. Prueba una cuantizacion mas pequena o el contexto 512.';
    }
    if (low.indexOf('failed to fetch') >= 0 || low.indexOf('network') >= 0 || low.indexOf('load failed') >= 0) {
      return 'No se pudo leer el modelo o el motor. Comprueba la conexion y reintenta.';
    }
    return fallback + (raw ? ' (' + raw.slice(0, 140) + ')' : '');
  }

  async function getLib() {
    if (lib) return lib;
    var mod = await import(ENGINE_URL + 'index.js');
    lib = mod;
    return lib;
  }

  async function doUnload() {
    if (abortCtl) { try { abortCtl.abort(); } catch (e) {} }
    var w = wllama;
    wllama = null;
    if (w) {
      try { await w.exit(); } catch (e) { /* already closed */ }
    }
  }

  function readLocal(url) {
    return new Promise(function (resolve, reject) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'blob';
        xhr.onload = function () {
          if ((xhr.status === 200 || xhr.status === 0) && xhr.response && xhr.response.size > 0) {
            resolve(xhr.response);
          } else {
            reject(new Error('No se pudo leer el archivo del modelo'));
          }
        };
        xhr.onerror = function () { reject(new Error('No se pudo leer el archivo del modelo')); };
        xhr.send();
      } catch (e) {
        reject(e);
      }
    });
  }

  async function doLoad(m) {
    if (loading) return;
    loading = true;
    try {
      await doUnload();
      var mod;
      try {
        mod = await getLib();
      } catch (e) {
        lib = null;
        send({ type: 'error', message: 'No se pudo descargar el motor local. Conectate a internet para la primera carga y reintenta.' });
        return;
      }

      var paths = {
        'single-thread/wllama.wasm': ENGINE_URL + 'single-thread/wllama.wasm',
        'multi-thread/wllama.wasm': ENGINE_URL + 'multi-thread/wllama.wasm'
      };
      var w = new mod.Wllama(paths);

      var nCtx = Number(m.nCtx) || 512;
      var nThreads = Number(m.nThreads) || 2;
      var lastPct = -1;
      var cfg = {
        n_ctx: nCtx,
        n_threads: nThreads,
        n_batch: 128,
        progressCallback: function (p) {
          try {
            var total = p && p.total ? p.total : 0;
            var pr = total > 0 ? Math.max(0, Math.min(1, p.loaded / total)) : 0;
            var pct = Math.round(pr * 100);
            if (pct !== lastPct) {
              lastPct = pct;
              send({ type: 'loadProgress', progress: pr });
            }
          } catch (e) {}
        }
      };

      send({ type: 'loadProgress', progress: 0 });
      var url = String(m.modelUrl || '');
      try {
        if (/^https?:/i.test(url)) {
          await w.loadModelFromUrl(url, cfg);
        } else {
          var blob = null;
          try {
            blob = await readLocal(url);
          } catch (e1) {
            var resp = await fetch(url);
            if (!resp.ok) throw new Error('No se pudo leer el archivo del modelo');
            blob = await resp.blob();
          }
          await w.loadModel([blob], cfg);
        }
      } catch (e) {
        try { await w.exit(); } catch (x) {}
        send({ type: 'error', message: friendlyError(e, 'No se pudo cargar el modelo.') });
        return;
      }
      wllama = w;
      send({ type: 'loadProgress', progress: 1 });
      send({ type: 'loaded' });
    } finally {
      loading = false;
    }
  }

  function cutIndex(text) {
    var best = -1;
    for (var i = 0; i < MARKERS.length; i++) {
      var k = text.indexOf(MARKERS[i]);
      if (k >= 0 && (best < 0 || k < best)) best = k;
    }
    return best;
  }

  function heldBackStart(text) {
    var lt = text.lastIndexOf('<');
    if (lt < 0) return -1;
    var tail = text.slice(lt);
    for (var i = 0; i < MARKERS.length; i++) {
      if (MARKERS[i].indexOf(tail) === 0 && tail.length < MARKERS[i].length) return lt;
    }
    return -1;
  }

  async function doGenerate(m) {
    if (!wllama) {
      send({ type: 'error', message: 'El modelo no esta cargado en el motor.' });
      return;
    }
    if (generating) {
      queued = m;
      userStopped = true;
      if (abortCtl) { try { abortCtl.abort(); } catch (e) {} }
      return;
    }
    generating = true;
    userStopped = false;
    var ctl = new AbortController();
    abortCtl = ctl;
    var emitted = 0;
    var stopped = false;
    var lastText = '';

    function emit(text, final) {
      var cut = cutIndex(text);
      var end = cut >= 0 ? cut : text.length;
      if (cut < 0 && !final) {
        var held = heldBackStart(text);
        if (held >= 0) end = held;
      }
      if (end > emitted) {
        send({ type: 'token', text: text.slice(emitted, end) });
        emitted = end;
      }
      return cut >= 0;
    }

    try {
      try { if (typeof wllama.kvClear === 'function') await wllama.kvClear(); } catch (e) {}
      var temp = Number(m.temperature);
      if (!(temp >= 0)) temp = 0.7;
      await wllama.createCompletion(String(m.prompt || ''), {
        nPredict: Math.max(1, Number(m.maxTokens) || 128),
        sampling: { temp: temp, top_k: 40, top_p: 0.9 },
        abortSignal: ctl.signal,
        onNewToken: function (token, piece, currentText) {
          if (stopped || ctl.signal.aborted) return;
          lastText = String(currentText || '');
          if (emit(lastText, false)) {
            stopped = true;
            try { ctl.abort(); } catch (e) {}
          }
        }
      });
      if (!stopped && !ctl.signal.aborted) emit(lastText, true);
    } catch (e) {
      if (!(ctl.signal.aborted || stopped)) {
        generating = false;
        abortCtl = null;
        var nextAfterError = queued;
        queued = null;
        if (nextAfterError) {
          doGenerate(nextAfterError);
          return;
        }
        send({ type: 'error', message: friendlyError(e, 'Fallo al generar la respuesta.') });
        return;
      }
    }
    generating = false;
    abortCtl = null;
    var next = queued;
    queued = null;
    if (next) {
      doGenerate(next);
      return;
    }
    send({ type: 'done' });
  }

  function handle(d) {
    switch (d.type) {
      case 'load':
        doLoad(d);
        break;
      case 'generate':
        doGenerate(d);
        break;
      case 'stop':
        queued = null;
        userStopped = true;
        if (abortCtl) { try { abortCtl.abort(); } catch (e) {} }
        break;
      case 'unload':
        queued = null;
        doUnload();
        break;
      default:
        break;
    }
  }

  function onMsg(ev) {
    var d = ev && ev.data;
    if (typeof d === 'string') {
      try { d = JSON.parse(d); } catch (e) { return; }
    }
    if (!d || typeof d !== 'object' || !d.type) return;
    handle(d);
  }

  window.addEventListener('message', onMsg);
  document.addEventListener('message', onMsg);

  window.addEventListener('error', function (ev) {
    if (!loading && !generating) return;
    send({ type: 'error', message: 'Error interno del motor local.' });
  });

  send({ type: 'ready' });
})();
</script>
</body>
</html>`;
