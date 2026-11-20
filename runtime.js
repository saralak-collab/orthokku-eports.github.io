(function () {
  'use strict';
  const config = window.ORTHOFOLIO_PAGES_CONFIG || {};
  const assetBase = new URL('.', document.currentScript.src);
  const protocol = 'orthofolio-pages-v1';
  const panel = document.getElementById('pages-connection');
  const status = document.getElementById('pages-connection-status');
  const retry = document.getElementById('pages-connection-retry');
  const content = document.getElementById('pages-content');
  let dispose = function () {};
  retry.addEventListener('click', function () { window.location.reload(); });

  function googleOrigin(origin) {
    return /^https:\/\/(?:[a-z0-9-]+\.)?script\.googleusercontent\.com$/.test(origin) ||
      /^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/.test(origin);
  }

  function connect() {
    const url = new URL(config.backendUrl);
    if (url.origin !== 'https://script.google.com' ||
        !/^\/(?:a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(url.pathname)) {
      throw new Error('ที่อยู่ระบบหลังบ้านไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ');
    }
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    const channel = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    url.searchParams.set('page', 'pages-bridge');
    url.searchParams.set('parentOrigin', window.location.origin);
    url.searchParams.set('channel', channel);
    const frame = document.createElement('iframe');
    frame.title = 'OrthoFolio connection';
    frame.hidden = true;
    frame.referrerPolicy = 'no-referrer';
    let peer = null, peerOrigin = '', sequence = 0, stopped = false;
    let resolveReady, rejectReady;
    const pending = new Map(), queue = [];
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const connectionTimeout = setTimeout(function () {
      rejectReady(new Error('เชื่อมต่อระบบไม่ได้ กรุณาลองอีกครั้งหรือติดต่อผู้ดูแลระบบ'));
    }, config.connectionTimeoutMs || 45000);

    function send(message) {
      peer.postMessage(Object.assign({protocol, channel}, message), peerOrigin);
    }
    function finish(id, error, value) {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      clearTimeout(request.timer);
      if (error) request.reject(error); else request.resolve(value);
      pump();
    }
    function pump() {
      if (!peer || stopped) return;
      // Leave room below the Apps Script client limit of 10 concurrent calls.
      while (pending.size < 8 && queue.length) {
        const request = queue.shift();
        pending.set(request.id, request);
        request.timer = setTimeout(function () {
          finish(request.id, new Error('หมดเวลารอผลจากระบบ กรุณาตรวจสอบข้อมูลก่อนลองบันทึกอีกครั้ง'));
        }, config.requestTimeoutMs || 180000);
        try { send({type: 'call', id: request.id, method: request.method, args: request.args}); }
        catch (error) { finish(request.id, error); }
      }
    }
    function receive(event) {
      const message = event.data;
      if (!message || message.protocol !== protocol || message.channel !== channel ||
          !googleOrigin(event.origin) || !event.source) return;
      if (!peer) {
        if (message.type !== 'ready' || stopped) return;
        peer = event.source;
        peerOrigin = event.origin;
        clearTimeout(connectionTimeout);
        send({type: 'ack'});
        resolveReady();
        pump();
        return;
      }
      if (event.source !== peer || event.origin !== peerOrigin) return;
      if (message.type === 'result') finish(message.id, null, message.value);
      if (message.type === 'error') finish(message.id, new Error(String(message.message || 'Server error')));
    }
    window.addEventListener('message', receive);
    dispose = function () {
      stopped = true;
      clearTimeout(connectionTimeout);
      window.removeEventListener('message', receive);
      const error = new Error('Connection closed');
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      for (const request of queue) request.reject(error);
      pending.clear();
      queue.length = 0;
      frame.remove();
    };
    frame.src = url.href;
    document.body.appendChild(frame);
    return {
      ready,
      async call(method, args) {
        await ready;
        if (stopped) throw new Error('Connection closed');
        return new Promise((resolve, reject) => {
          queue.push({id: ++sequence, method, args, resolve, reject});
          pump();
        });
      }
    };
  }

  function installGoogleRunner(connection) {
    function runner(handlers) {
      return new Proxy(Object.create(null), {
        get(_target, name) {
          if (name === 'withSuccessHandler') return fn => runner(Object.assign({}, handlers, {success: fn}));
          if (name === 'withFailureHandler') return fn => runner(Object.assign({}, handlers, {failure: fn}));
          if (name === 'withUserObject') return value => runner(Object.assign({}, handlers, {user: value}));
          if (typeof name !== 'string' || name === 'then' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return undefined;
          return function (...args) {
            connection.call(name, args).then(function (value) {
              if (typeof handlers.success === 'function') handlers.success(value, handlers.user);
            }, function (error) {
              if (typeof handlers.failure === 'function') handlers.failure(error, handlers.user);
              else console.error('OrthoFolio request failed:', error.message);
            });
          };
        }
      });
    }
    window.google = window.google || {};
    window.google.script = window.google.script || {};
    Object.defineProperty(window.google.script, 'run', {get: function () { return runner({}); }});
    window.google.script.url = {
      getLocation(callback) {
        const url = new URL(window.location.href), parameters = {}, parameter = {};
        for (const key of new Set(url.searchParams.keys())) {
          parameters[key] = url.searchParams.getAll(key);
          parameter[key] = parameters[key][0];
        }
        queueMicrotask(function () { callback({hash: url.hash.slice(1), parameter, parameters}); });
      }
    };
    window.ORTHOFOLIO_PAGES = Object.freeze({
      onLoad(callback) {
        if (document.readyState === 'complete') queueMicrotask(callback);
        else window.addEventListener('load', callback, {once: true});
      }
    });
  }

  function loadScript(name) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(name, assetBase).href;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('โหลดหน้าเว็บไม่สำเร็จ กรุณาลองอีกครั้ง')); };
      document.head.appendChild(script);
    });
  }

  async function start() {
    try {
      const connection = connect();
      await connection.ready;
      const bootstrap = await connection.call('getGitHubPagesBootstrap', []);
      if (!bootstrap || !bootstrap.initialData || !Array.isArray(bootstrap.electiveForm?.sections)) {
        throw new Error('ข้อมูลเริ่มต้นจากระบบไม่ครบ กรุณาติดต่อผู้ดูแลระบบ');
      }
      window.ORTHOFOLIO_INITIAL_DATA = bootstrap.initialData;
      window.ORTHOFOLIO_ELECTIVE_FORM = bootstrap.electiveForm;
      installGoogleRunner(connection);
      const scripts = document.body.dataset.orthofolioPage === 'external'
        ? ['external-elective.js']
        : ['legacy-import.js', 'external-elective-admin.js', 'application.js'];
      for (const script of scripts) await loadScript(script);
      content.removeAttribute('inert');
      panel.hidden = true;
    } catch (error) {
      dispose();
      status.textContent = error.message || 'เชื่อมต่อระบบไม่ได้ กรุณาลองอีกครั้ง';
      retry.hidden = false;
      panel.dataset.failed = 'true';
    }
  }
  start();
})();
