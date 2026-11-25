import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { NativeSessions, nativeKey, parseNative, type Activity, type NativePrefs } from '@/lib/nativeCallDetection';

export function useNativeCalls(prefs: NativePrefs, occupied: boolean, start: (guard: () => Promise<boolean>) => void) {
  const tracker = useRef(new NativeSessions());
  const focusEpoch = useRef(0);
  const [offer, setOffer] = useState<ReturnType<NativeSessions['sample']>>(null);
  const [error, setError] = useState('');
  const latest = useRef({ occupied, start, offer });
  latest.current = { occupied, start, offer };
  const claim = (family: number, record: boolean, automatic = false) => {
    if (!tracker.current.claim(family)) return;
    setOffer(null);
    // Bind automatic consent to the uninterrupted focus interval at expiry,
    // not the interval in which model preflight or the HAL read finishes.
    const epoch = focusEpoch.current;
    const stillAuthorized = () => !automatic ||
      (epoch === focusEpoch.current && document.hasFocus() && !document.hidden);
    if (record && !latest.current.occupied) latest.current.start(async () => {
      if (!stillAuthorized()) return false;
      const rows = await invoke<Activity[]>('native_call_activity');
      const consent = parseNative(localStorage.getItem(nativeKey));
      const same = rows.filter(row => row.family === family);
      return stillAuthorized() && consent.enabled && (!automatic || consent.autoStart) && same.some(row => row.input) && same.some(row => row.output);
    });
  };
  useEffect(() => {
    setOffer(null);
    setError('');
    if (!prefs.enabled) { tracker.current = new NativeSessions(); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let presented: number | undefined;
    const disarm = () => { focusEpoch.current++; tracker.current.disarm(); };
    window.addEventListener('blur', disarm);
    document.addEventListener('visibilitychange', disarm);
    const poll = async () => {
      try {
        const rows = await invoke<Activity[]>('native_call_activity');
        if (!alive) return;
        const consent = parseNative(localStorage.getItem(nativeKey));
        const visible = document.hasFocus() && !document.hidden ? latest.current.offer?.family ?? null : null;
        const next = tracker.current.sample(rows, performance.now(), consent, latest.current.occupied, visible);
        setError('');
        setOffer(next);
        if (next && presented !== next.family) {
          // Bring the window that actually renders the cancel button forward.
          await invoke('open_recording_companion_settings');
        } else if (next?.seconds === 0) claim(next.family, true, true);
        presented = next?.family;
      } catch (err) {
        if (!alive) return;
        tracker.current.unknown(); setOffer(null); setError(String(err));
      }
      if (alive) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      alive = false; clearTimeout(timer); disarm();
      window.removeEventListener('blur', disarm);
      document.removeEventListener('visibilitychange', disarm);
    };
  }, [prefs.enabled, prefs.autoStart]);
  const status = !prefs.enabled ? 'Native detection is off.' : error ? `${error} Manual recording remains available.` : offer ?
    !prefs.autoStart ? 'Possible call detected. Start recording?' : offer.seconds === null ? 'Focus Meetily to begin the countdown.' : `Recording starts in ${offer.seconds}s.` :
    occupied ? 'Recording controls own this session.' : 'Waiting for sustained input and output from one external app.';
  return { offer: prefs.enabled && !occupied ? offer : null, status, claim };
}
