let native;
let selected;
let lastSample = 0;
const tabs = new Set();

chrome.runtime.onConnect.addListener((tab) => {
  if (tab.name !== 'meetily-observer' || tab.sender?.frameId !== 0 ||
      !tab.sender.url?.startsWith('https://meet.google.com/')) return;

  tabs.add(tab);
  if (!native) {
    native = chrome.runtime.connectNative('com.meetily.google_meet');
    native.onMessage.addListener((message) => {
      for (const observer of tabs) observer.postMessage(message);
    });
    native.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      native = undefined;
      selected = undefined;
      for (const observer of tabs) observer.disconnect();
      tabs.clear();
    });
  }
  tab.onMessage.addListener((message) => {
    // A second Meet tab (including a lobby) must not overwrite a live tab.
    const now = Date.now();
    if (selected && selected !== tab && now - lastSample < 6000) return;
    if (message.phase === 'joined' || selected === tab) {
      selected = tab;
      lastSample = now;
    }
    native?.postMessage(message);
  });
  tab.onDisconnect.addListener(() => {
    tabs.delete(tab);
    if (selected === tab) selected = undefined;
    if (tabs.size === 0) {
      native?.disconnect();
      native = undefined;
    }
  });
});
