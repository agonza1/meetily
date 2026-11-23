import { describe, expect, test } from 'bun:test';
import { canFireCountdown, END_MS, JOIN_MS, offerFor, parseMeetPreferences, updateEvidence, type Evidence } from '../../src/lib/googleMeetDetection';

const { meetPhase } = require('../../../integrations/chrome-meet/signals.js');
const enabled = { enabled: true, autoStart: false, autoStop: false };
const joined = { call: 'one', phase: 'joined' } as const;
const ended = { call: 'one', phase: 'ended' } as const;
const sample = (observation: typeof joined | typeof ended, duration: number) => {
  let evidence: Evidence | null = null;
  for (let ms = 0; ms <= duration; ms += 1000) evidence = updateEvidence(evidence, observation, ms);
  return evidence;
};

describe('Chrome Meet signals', () => {
  test('landing, lobby, and single or conflicting controls are not joined', () => {
    expect(meetPhase('/', true, true, false)).toBe('unknown');
    for (const [leave, inCall, rejoin] of [[false, false, false], [true, false, false], [false, true, false], [true, true, true]]) {
      expect(meetPhase('/abc-defg-hij', leave, inCall, rejoin)).toBe('unknown');
    }
    expect(meetPhase('/abc-defg-hij', true, true, false)).toBe('joined');
    expect(meetPhase('/abc-defg-hij', false, false, true)).toBe('ended');
  });
});

describe('Meet recording policy', () => {
  test('defaults and invalid storage are off; opt-ins are independently parsed', () => {
    for (const raw of [null, 'null', 'bad', '{"enabled":"true","autoStart":1}']) {
      expect(parseMeetPreferences(raw)).toEqual({ enabled: false, autoStart: false, autoStop: false });
    }
    expect(parseMeetPreferences('{"enabled":true,"autoStop":true}')).toEqual({ ...enabled, autoStop: true });
  });

  test('joined evidence needs debounce; detection alone only offers a prompt', () => {
    expect(offerFor(sample(joined, JOIN_MS - 1000), JOIN_MS - 1000, enabled, false, false, null, false, false)).toBeNull();
    const evidence = sample(joined, JOIN_MS);
    expect(offerFor(evidence, JOIN_MS, enabled, false, false, null, false, false)).toEqual({ call: 'one', action: 'prompt' });
    expect(offerFor(evidence, JOIN_MS, { ...enabled, autoStart: true }, false, false, null, false, false)).toEqual({ call: 'one', action: 'start' });
  });

  test('recording, finalizing and same-call cancellation block repeat starts; a new call can prompt', () => {
    const evidence = sample(joined, JOIN_MS);
    for (const [recording, busy, suppressed] of [[true, false, false], [false, true, false], [false, false, true]]) {
      expect(offerFor(evidence, JOIN_MS, enabled, recording, busy, null, suppressed, false)).toBeNull();
    }
    expect(offerFor({ ...evidence!, call: 'two' }, JOIN_MS, enabled, false, false, null, false, false)?.call).toBe('two');
  });

  test('only a matching automatic owner can stop after stable explicit end evidence', () => {
    const prefs = { ...enabled, autoStop: true };
    const evidence = sample(ended, END_MS);
    for (const owner of [null, 'two']) {
      expect(offerFor(evidence, END_MS, prefs, true, false, owner, false, false)).toBeNull();
    }
    expect(offerFor(evidence, END_MS, enabled, true, false, 'one', false, false)).toBeNull();
    expect(offerFor(evidence, END_MS, prefs, true, false, 'one', false, true)).toBeNull();
    expect(offerFor(sample(ended, END_MS - 1000), END_MS - 1000, prefs, true, false, 'one', false, false)).toBeNull();
    expect(offerFor(evidence, END_MS, prefs, true, false, 'one', false, false)).toEqual({ call: 'one', action: 'stop' });
  });

  test('unknown and sleep gaps reset end evidence instead of stopping', () => {
    const before = sample(ended, END_MS - 1000);
    expect(updateEvidence(before, { ...ended, phase: 'unknown' }, END_MS)).toBeNull();
    expect(updateEvidence(before, null, END_MS)).toBeNull();
    const afterSleep = updateEvidence(before, ended, END_MS + 30_000);
    expect(offerFor(afterSleep, END_MS + 30_000, { ...enabled, autoStop: true }, true, false, 'one', false, false)).toBeNull();
  });

  test('a countdown cannot fire while unfocused, stale, canceled or unfinished', () => {
    const evidence = sample(ended, END_MS);
    expect(canFireCountdown(evidence, END_MS, true, 0)).toBe(true);
    expect(canFireCountdown(evidence, END_MS, false, 0)).toBe(false);
    expect(canFireCountdown(evidence, END_MS, true, 1)).toBe(false);
    expect(canFireCountdown(evidence, END_MS, true, null)).toBe(false);
    expect(canFireCountdown(evidence, END_MS + 30_000, true, 0)).toBe(false);
  });
});
