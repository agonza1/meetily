import { expect, test } from 'bun:test';
import { NativeSessions, parseNative, type Activity } from '../../src/lib/nativeCallDetection';

const mic = { family: 10, input: 1, output: 0 };
const speaker = { family: 10, input: 0, output: 1 };
const both = [mic, speaker];
const prefs = { enabled: true, autoStart: true };
function setup() {
  const tracker = new NativeSessions();
  let time = 0;
  const tick = (rows: Activity[], occupied = false, visible: number | null = null, consent = prefs) =>
    tracker.sample(rows, time += 1000, consent, occupied, visible);
  return { tick, tracker };
}

test('native opt-in is independent, off by default, and gates snapshots', () => {
  const off = parseNative(null);
  expect(parseNative('{"autoStart":true}')).toEqual(off);
  const { tick } = setup();
  for (let n = 0; n < 15; n++) expect(tick(both, false, 10, off)).toBeNull();
});

test('single directions, unrelated families and transient duplex never offer', () => {
  const { tick } = setup();
  for (const rows of [[mic], [speaker], [mic, { ...speaker, family: 11 }]])
    for (let n = 0; n < 10; n++) expect(tick(rows)).toBeNull();
  for (let n = 0; n < 4; n++) expect(tick(both)).toBeNull();
  expect(tick([])).toBeNull();
});

test('countdown requires sustained family and visible offer; cancellation consumes session', () => {
  const { tick, tracker } = setup();
  for (let n = 0; n < 4; n++) expect(tick(both)).toBeNull();
  expect(tick(both)).toEqual({ family: 10, seconds: null });
  expect(tick(both, false, 10)?.seconds).toBe(8);
  expect(tick(both, false, 10)?.seconds).toBe(7);
  tracker.disarm();
  expect(tick(both, false, 10)?.seconds).toBe(8);
  expect(tracker.claim(10)).toBe(true);
  expect(tracker.claim(10)).toBe(false);
  for (let n = 0; n < 20; n++) expect(tick(n < 10 ? [mic] : both)).toBeNull();
  for (let n = 0; n < 10; n++) tick([]);
  for (let n = 0; n < 4; n++) tick(both);
  expect(tick(both)?.family).toBe(10);
});

test('a manual recording owns the session even after stopping', () => {
  const { tick } = setup();
  tick(both, true);
  for (let n = 0; n < 20; n++) expect(tick(both, false, 10)).toBeNull();
});
