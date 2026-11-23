(() => {
  let port;
  let enabled = false;
  let call = null;
  let path;
  let ended = false;
  let offer;
  let received = 0;
  let countdown = null;
  let response = null;
  let responseAt = 0;
  let surface;

  function hide() {
    countdown = null;
    surface?.host.remove();
  }
  function interrupt() {
    hide();
    if (response?.[1] === 'execute') {
      responseAt = 0;
      if (call && enabled) port?.postMessage({ call, phase: 'unknown' });
    }
  }
  window.addEventListener('blur', interrupt);
  document.addEventListener('visibilitychange', interrupt);

  function showCountdown(phase, now) {
    if (!offer || offer.call !== call || offer.phase !== phase || now - received > 4500 ||
        document.hidden || !document.hasFocus()) {
      interrupt();
      return null;
    }
    if (response?.[0] === offer.nonce) return now - responseAt < 3000 ? response : null;
    if (!surface) {
      const host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647';
      const root = host.attachShadow({ mode: 'closed' });
      const panel = document.createElement('section');
      panel.setAttribute('aria-label', 'Meetily recording countdown');
      panel.style.cssText = 'font:14px system-ui;color:#171717;background:#fafafa;border:1px solid #777;border-radius:10px;padding:12px;box-shadow:0 4px 20px #0004;min-width:230px';
      const label = document.createElement('div');
      label.style.marginBottom = '8px';
      const nowButton = document.createElement('button');
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.style.marginLeft = '8px';
      panel.append(label, nowButton, cancel);
      root.append(panel);
      const usable = () => !document.hidden && document.hasFocus() && [nowButton, cancel].every(button => {
        const r = button.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === host;
      });
      const choose = (event, action) => {
        if (!event.isTrusted || !countdown || !usable()) return;
        response = [countdown.nonce, action];
        responseAt = Date.now();
        hide();
        tick();
      };
      nowButton.onclick = event => choose(event, 'now');
      cancel.onclick = event => choose(event, 'cancel');
      surface = { host, label, nowButton, usable };
    }
    const starting = phase === 'joined';
    surface.nowButton.textContent = starting ? 'Start now' : 'Stop now';
    if (!surface.host.isConnected) document.documentElement.append(surface.host);
    countdown = advanceCountdown(countdown, offer.nonce, now, surface.usable());
    if (!countdown) return null;
    const seconds = Math.max(0, Math.ceil((10_000 - (now - countdown.since)) / 1000));
    surface.label.textContent = `Meetily: ${starting ? 'recording starts' : 'recording stops'} in ${seconds}s`;
    if (seconds === 0) {
      response = [offer.nonce, 'execute'];
      responseAt = now;
      hide();
      return response;
    }
    return null;
  }

  const visible = (element) => element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility === 'visible' &&
    !element.closest('[aria-hidden="true"], [inert]');

  function tick() {
    if (!port) {
      const connection = chrome.runtime.connect({ name: 'meetily-observer' });
      port = connection;
      connection.onDisconnect.addListener(() => {
        if (port !== connection) return;
        port = undefined;
        enabled = false;
        offer = undefined;
        interrupt();
      });
      connection.onMessage.addListener((message) => {
        if (offer?.nonce !== message.offer?.nonce) {
          hide();
          response = null;
        }
        enabled = message.enabled === true;
        offer = message.offer;
        received = Date.now();
      });
    }
    if (!enabled) {
      hide();
      port.postMessage({});
      return;
    }
    const roomPath = location.pathname.replace(/\/$/, '');
    if (roomPath !== path) {
      call = null;
      ended = false;
      path = roomPath;
    }
    const leave = Array.from(document.querySelectorAll('[aria-label="Leave call"]')).some(visible);
    const inCall = Array.from(document.querySelectorAll(
      '[aria-label="Show everyone"], [aria-label="Chat with everyone"], [aria-label="Meeting details"]'
    )).some(visible);
    const rejoin = Array.from(document.querySelectorAll('button, [role="button"]')).some(
      (button) => /^rejoin(?:\s+(?:call|meeting))?$/i.test((button.getAttribute('aria-label') || button.textContent).trim()) && visible(button)
    );
    const phase = meetPhase(path, leave, inCall, rejoin);
    if (phase === 'joined' && (!call || ended)) {
      call = crypto.randomUUID();
      ended = false;
    }
    // A lobby, new tab, navigation, or disconnected bridge isn't an end.
    if (phase === 'ended' && call) ended = true;
    const answer = showCountdown(phase, Date.now());
    port.postMessage(call ? { call, phase, ...(answer ? { response: answer } : {}) } : {});
  }

  tick();
  setInterval(tick, 2000);
})();
