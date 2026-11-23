import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type { MeetObservation } from '../../src/lib/googleMeetDetection';

const scripts = ['signals.js', 'countdown.js', 'observe.js'].map(file =>
  readFileSync(new URL(`../../../integrations/chrome-meet/${file}`, import.meta.url), 'utf8'),
).join('\n');

class Element {
  style = { cssText: '', marginBottom: '', marginLeft: '' };
  children: Element[] = [];
  textContent = '';
  isConnected = false;
  onclick?: (event: { isTrusted: boolean }) => void;
  append(...children: Element[]) { this.children.push(...children); }
  attachShadow() { const root = new Element(); this.append(root); return root; }
  setAttribute() {}
  getAttribute() { return null; }
  closest() { return null; }
  getClientRects() { return [{}]; }
  getBoundingClientRect() { return { x: 0, y: 0, width: 20, height: 20 }; }
  remove() { this.isConnected = false; }
}

function startObserver(phase: 'joined' | 'ended') {
  let now = 100_000;
  let focused = true;
  let joined = true;
  let tick!: () => void;
  let blur!: () => void;
  let receive!: (message: object) => void;
  let host: Element | undefined;
  let snapshot: MeetObservation | undefined;
  const rejoin = Object.assign(new Element(), { textContent: 'Rejoin' });
  runInNewContext(scripts, {
    Date: { now: () => now },
    setInterval: (callback: () => void) => { tick = callback; },
    location: { pathname: '/abc-defg-hij' },
    crypto: { randomUUID: () => 'test-call' },
    window: { addEventListener: (_: string, callback: () => void) => { blur = callback; } },
    getComputedStyle: () => ({ visibility: 'visible' }),
    document: {
      hidden: false,
      addEventListener() {},
      hasFocus: () => focused,
      createElement: () => new Element(),
      elementFromPoint: () => host,
      documentElement: { append: (node: Element) => { host = node; host.isConnected = true; } },
      querySelectorAll: (selector: string) => selector.startsWith('button')
        ? (joined ? [] : [rejoin]) : (joined ? [new Element()] : []),
    },
    chrome: { runtime: { connect: () => ({
      onDisconnect: { addListener() {} },
      onMessage: { addListener: (callback: typeof receive) => { receive = callback; } },
      // Like Native Messaging, retain only the latest valid observation.
      postMessage: (sample: MeetObservation) => { if (sample.call) snapshot = sample; },
    }) } },
  });
  receive({ enabled: true });
  tick(); // Establish call identity before offering Stop on the rejoin screen.
  joined = phase === 'joined';
  let nonce: string | undefined = 'offer';
  const poll = (advance = 2000) => {
    now += advance;
    receive({ enabled: true, offer: nonce && { call: 'test-call', phase, nonce } });
    tick();
    return snapshot;
  };
  const countdown = () => host?.isConnected ? host.children[0].children[0].children : [];
  poll();
  return {
    poll,
    countdown,
    loseFocus: () => { focused = false; blur(); },
    refocus: () => { focused = true; },
    setOffer: (id?: string) => { nonce = id; },
    latest: () => snapshot,
  };
}

for (const phase of ['joined', 'ended'] as const) {
  test(`${phase}: blur after execute revokes the snapshot and refocus restores a cancelable countdown`, () => {
    const observer = startObserver(phase);
    for (let i = 0; i < 5; i++) observer.poll();
    expect(observer.latest()?.response).toEqual(['offer', 'execute']);

    observer.loseFocus();
    // The app misses the event itself and has not switched nonces. The next
    // browser tick must not put positive evidence back in the single-slot host.
    expect(observer.poll()).toEqual({ call: 'test-call', phase: 'unknown' });
    expect(observer.poll()?.phase).toBe('unknown');
    expect(observer.countdown()).toHaveLength(0);

    observer.refocus();
    expect(observer.poll()?.response).toBeUndefined();
    const [label, now, cancel] = observer.countdown();
    expect(label.textContent).toMatch(/in 10s$/);
    expect(now.textContent).toBe(phase === 'joined' ? 'Start now' : 'Stop now');
    expect(cancel.textContent).toBe('Cancel');
    cancel.onclick?.({ isTrusted: true });
    observer.loseFocus();
    expect(observer.poll(4000)?.response).toEqual(['offer', 'cancel']);
    observer.refocus();
    observer.setOffer('replacement');
    expect(observer.poll()?.response).toEqual(['replacement', 'cancel']);
    expect(observer.countdown()).toHaveLength(0);
  });
}

test('observer retries an expired execute only after ten fresh visible seconds, and stops when the offer is withdrawn', () => {
  const observer = startObserver('joined');
  for (let i = 0; i < 5; i++) observer.poll();
  expect(observer.latest()?.response).toEqual(['offer', 'execute']);
  expect(observer.poll(3000)?.response).toBeUndefined();
  expect(observer.countdown()[0].textContent).toMatch(/in 10s$/);
  for (let i = 0; i < 4; i++) expect(observer.poll()?.response).toBeUndefined();
  expect(observer.poll()?.response).toEqual(['offer', 'execute']);
  observer.setOffer(); // The app consumed it and withdrew the offer.
  for (let i = 0; i < 7; i++) expect(observer.poll()?.response).toBeUndefined();
  expect(observer.countdown()).toHaveLength(0);
});
