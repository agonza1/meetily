import React from 'react';
import { afterAll, expect, mock, spyOn, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { CompanionSnapshot } from '../../src/lib/recordingCompanion';
import { RecordingStatus } from '../../src/contexts/RecordingStateContext';
import { nativeKey } from '../../src/lib/nativeCallDetection';

const paths = ['next/navigation', '@tauri-apps/api/core', '@tauri-apps/api/event', '../../src/lib/recordingCompanion',
  '../../src/contexts/RecordingStateContext', '../../src/contexts/ConfigContext', '../../src/hooks/useRecordingStart'];
const originals = await Promise.all(paths.map(async path => [path, { ...await import(path) }] as const));
afterAll(() => { for (const [path, exports] of originals) mock.module(path, () => exports); });

const activity = [{ family: 11, input: 1, output: 1 }];
let finalSnapshot: Promise<typeof activity> | undefined;
let decision: Promise<boolean> | undefined;
let delivered: CompanionSnapshot | undefined;
const stale = 'Previous recording failed';
mock.module('next/navigation', () => ({ useRouter: () => ({}) }));
mock.module('@tauri-apps/api/core', () => ({ invoke: async (cmd: string) =>
  cmd === 'native_call_activity' ? finalSnapshot ?? activity : null }));
mock.module('@tauri-apps/api/event', () => ({ listen: async () => () => {},
  emitTo: async (_window: string, _event: string, snapshot: CompanionSnapshot) => { delivered = snapshot; } }));
mock.module('../../src/lib/recordingCompanion', () => ({ isMacRecordingCompanion: () => true }));
mock.module('../../src/contexts/RecordingStateContext', () => ({ useRecordingState: () => ({ status: RecordingStatus.ERROR, statusMessage: stale }) }));
mock.module('../../src/contexts/ConfigContext', () => ({ useConfig: () => ({}) }));
let finishSnapshot: () => void;
mock.module('../../src/hooks/useRecordingStart', () => ({ useRecordingStart: () => ({
  handleRecordingStart: async (_meet: unknown, guard: () => Promise<boolean>) => {
    finalSnapshot = new Promise(resolve => { finishSnapshot = () => resolve(activity); });
    decision = guard();
    await decision;
  },
}) }));
const { MeetRecordingPanel } = await import('../../src/components/MeetRecordingPanel');

for (const scenario of ['focused', 'blur', 'blur-refocus', 'hide-show', 'manual'] as const) {
  test(`native countdown with stale error and deferred HAL: ${scenario}`, async () => {
    let focused = true;
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => focused });
    const storage = { getItem: (key: string) => key === nativeKey ? '{"enabled":true,"autoStart":true}' : null };
    const globals = Object.getOwnPropertyDescriptors(globalThis);
    for (const [key, value] of Object.entries({ window: win, document: doc, localStorage: storage })) {
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    let now = 0;
    let poll: () => void;
    const clock = spyOn(performance, 'now').mockImplementation(() => now);
    const timeout = globalThis.setTimeout;
    const schedule = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, delay: number) => {
      if (delay !== 1000) return timeout(fn, delay);
      poll = fn;
      return 0;
    }) as typeof setTimeout);
    finalSnapshot = decision = delivered = undefined;
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => { renderer = create(<MeetRecordingPanel />); });
      const tick = async () => { now += 1000; await act(async () => poll()); };
      for (let i = 0; i < 5; i++) await tick();
      for (let seconds = 8; seconds > 0; seconds--) {
        const countdown = `Recording starts in ${seconds}s.`;
        expect(JSON.stringify(renderer!.toJSON())).toContain(countdown);
        expect(delivered!).toMatchObject({ nativeFamily: 11, nativeStatus: countdown, message: stale });
        expect(decision).toBeUndefined();
        if (scenario === 'manual') {
          await act(async () => renderer!.root.findAllByType('button').find(b => b.children.includes('Start recording'))!.props.onClick());
          break;
        }
        await tick();
      }
      expect(decision).toBeDefined();
      if (scenario === 'hide-show') {
        doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
        doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
      } else if (scenario !== 'focused') {
        focused = false; win.dispatchEvent(new Event('blur'));
        if (scenario === 'blur-refocus') { focused = true; win.dispatchEvent(new Event('focus')); }
      }
      await act(async () => { finishSnapshot(); expect(await decision).toBe(scenario === 'focused' || scenario === 'manual'); });
    } finally {
      if (renderer) await act(async () => renderer!.unmount());
      schedule.mockRestore(); clock.mockRestore();
      for (const key of ['window', 'document', 'localStorage'] as const) {
        if (globals[key]) Object.defineProperty(globalThis, key, globals[key]);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
}
