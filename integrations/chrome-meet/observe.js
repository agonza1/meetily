(() => {
  let port;
  let enabled = false;
  let call = null;
  let path;
  let ended = false;

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
      });
      connection.onMessage.addListener((message) => { enabled = message.enabled === true; });
    }
    if (!enabled) {
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
    port.postMessage(call ? { call, phase } : {});
  }

  tick();
  setInterval(tick, 2000);
})();
