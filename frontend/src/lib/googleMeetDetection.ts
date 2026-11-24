export interface MeetPreferences {
  enabled: boolean;
  autoStart: boolean;
  autoStop: boolean;
}

export const meetPreferencesKey = 'google-meet-detection-v1';
export function parseMeetPreferences(raw: string | null): MeetPreferences {
  try {
    const value = JSON.parse(raw ?? '{}');
    return { enabled: value?.enabled === true, autoStart: value?.autoStart === true, autoStop: value?.autoStop === true };
  } catch {
    return { enabled: false, autoStart: false, autoStop: false };
  }
}

export type MeetObservation = {
  call: string;
  phase: 'joined' | 'ended' | 'unknown';
  response?: [nonce: string, action: 'execute' | 'now' | 'cancel'];
};
export const JOIN_MS = 4_000;
export const END_MS = 20_000;
const MAX_SAMPLE_GAP_MS = 3_500;

export interface Evidence {
  call: string;
  phase: 'joined' | 'ended';
  since: number;
  last: number;
}

export function updateEvidence(previous: Evidence | null, sample: MeetObservation | null, now: number): Evidence | null {
  if (!sample || sample.phase === 'unknown') return null;
  const consecutive = previous?.call === sample.call && previous.phase === sample.phase &&
    now >= previous.last && now - previous.last <= MAX_SAMPLE_GAP_MS;
  return { call: sample.call, phase: sample.phase, since: consecutive ? previous.since : now, last: now };
}

export function offerFor(evidence: Evidence | null, now: number, prefs: MeetPreferences, recording: boolean,
  busy: boolean, owner: string | null, suppressed: boolean, stopCancelled: boolean) {
  if (!prefs.enabled || !evidence || busy || now - evidence.last > MAX_SAMPLE_GAP_MS) return null;
  const { call, phase, since } = evidence;
  if (!recording && !suppressed && phase === 'joined' && now - since >= JOIN_MS) {
    return { call, action: prefs.autoStart ? 'start' : 'prompt' } as const;
  }
  if (recording && prefs.autoStop && !stopCancelled && owner === call && phase === 'ended' && now - since >= END_MS) {
    return { call, action: 'stop' } as const;
  }
  return null;
}
