import { isTauri } from '@tauri-apps/api/core';
import type { MeetPreferences } from '@/lib/googleMeetDetection';
import type { NativePrefs } from '@/lib/nativeCallDetection';

export function isMacRecordingCompanion() {
  return isTauri() && navigator.userAgent.includes('Mac');
}

export const COMPANION_WINDOW = 'recording-panel';
export const COMPANION_SNAPSHOT = 'recording-companion-snapshot';
export const COMPANION_REQUEST = 'recording-companion-request';
export const COMPANION_ACTION = 'recording-companion-action';

export type CompanionSnapshot = {
  phase: 'idle' | 'starting' | 'recording' | 'paused' | 'saving' | 'error';
  elapsedSeconds: number;
  microphone: string;
  systemAudio: string;
  microphoneAvailable?: boolean;
  systemAvailable?: boolean;
  preferences: MeetPreferences;
  native: NativePrefs;
  nativeStatus: string;
  nativeFamily: number | null;
  offer: 'prompt' | 'start' | 'stop' | null;
  message?: string;
  busy: boolean;
};

export type CompanionAction =
  | { type: 'native-preference'; key: keyof NativePrefs; value: boolean }
  | { type: 'native-offer'; family: number; record: boolean }
  | { type: 'start' | 'pause' | 'resume' | 'stop' | 'accept-offer' | 'dismiss-offer' | 'settings' }
  | { type: 'preference'; key: keyof MeetPreferences; value: boolean };

export function isCompanionAction(value: unknown): value is CompanionAction {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  if (value.type === 'native-preference') return 'key' in value && (value.key === 'enabled' || value.key === 'autoStart') && 'value' in value && typeof value.value === 'boolean';
  if (value.type === 'native-offer') return 'family' in value && typeof value.family === 'number' && 'record' in value && typeof value.record === 'boolean';

  if (value.type === 'preference') {
    return 'key' in value && 'value' in value &&
      (value.key === 'enabled' || value.key === 'autoStart' || value.key === 'autoStop') &&
      typeof value.value === 'boolean';
  }

  return value.type === 'start' || value.type === 'pause' || value.type === 'resume' ||
    value.type === 'stop' || value.type === 'accept-offer' || value.type === 'dismiss-offer' ||
    value.type === 'settings';
}
