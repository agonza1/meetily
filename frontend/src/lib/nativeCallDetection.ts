export const nativeKey = 'native-call-detection-v1';
export type NativePrefs = { enabled: boolean; autoStart: boolean };
export type Activity = { family: number; input: number; output: number };

let status = 'Checking detection settings...';
export const getNativeStatus = () => status;
export function publishNativeStatus(value: string) {
  status = value;
  window.dispatchEvent(new Event('native-call-status'));
}
export function subscribeNativeStatus(listener: () => void) {
  window.addEventListener('native-call-status', listener);
  return () => window.removeEventListener('native-call-status', listener);
}

export function parseNative(value: string | null): NativePrefs {
  try {
    const prefs = JSON.parse(value ?? '{}');
    return { enabled: prefs?.enabled === true, autoStart: prefs?.enabled === true && prefs?.autoStart === true };
  } catch { return { enabled: false, autoStart: false }; }
}

export function saveNative(key: keyof NativePrefs, value: boolean) {
  const previous = parseNative(localStorage.getItem(nativeKey));
  const next = { ...previous, [key]: value };
  if (!next.enabled) next.autoStart = false;
  localStorage.setItem(nativeKey, JSON.stringify(next));
  window.dispatchEvent(new Event(nativeKey));
}

// A failed snapshot is unknown, not a hang-up. Keep consumed sessions until
// both directions have been absent in consecutive successful observations.
export class NativeSessions {
  private sessions = new Map<number, { since: number; last: number; absent: number; claimed: boolean; countdown: number | null }>();
  claim(family: number) {
    const session = this.sessions.get(family);
    if (!session || session.claimed) return false;
    session.claimed = true;
    return true;
  }
  disarm() { for (const s of this.sessions.values()) s.countdown = null; }
  unknown() { for (const s of this.sessions.values()) { s.since = Infinity; s.absent = 0; s.countdown = null; } }
  sample(rows: Activity[], now: number, prefs: NativePrefs, occupied: boolean, visibleFamily: number | null) {
    if (!prefs.enabled) { this.sessions.clear(); return null; }
    const masks = new Map<number, number>();
    for (const r of rows) masks.set(r.family, (masks.get(r.family) ?? 0) | (r.input ? 1 : 0) | (r.output ? 2 : 0));
    for (const id of masks.keys()) if (!this.sessions.has(id)) {
      this.sessions.set(id, { since: now, last: now, absent: 0, claimed: false, countdown: null });
    }
    let offer = null;
    for (const [id, s] of this.sessions) {
      const gap = now - s.last > 2500;
      s.last = now;
      if (!masks.get(id)) {
        if (gap || !s.absent) s.absent = now;
        if (now - s.absent >= 8000) this.sessions.delete(id);
      } else { s.absent = 0; if (occupied) s.claimed = true; }
      if (gap || masks.get(id) !== 3) { s.since = Infinity; s.countdown = null; continue; }
      if (s.since === Infinity) s.since = now;
      if (offer || s.claimed || occupied || now - s.since < 4000) { s.countdown = null; continue; }
      s.countdown = prefs.autoStart && visibleFamily === id ? s.countdown ?? now : null;
      offer = { family: id, seconds: s.countdown === null ? null : Math.max(0, Math.ceil((s.countdown + 8000 - now) / 1000)) };
    }
    return offer;
  }
}
