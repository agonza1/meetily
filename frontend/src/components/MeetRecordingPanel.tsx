'use client';

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { platform } from '@tauri-apps/plugin-os';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfig } from '@/contexts/ConfigContext';
import { RecordingStatus, useRecordingState } from '@/contexts/RecordingStateContext';
import { useRecordingStart } from '@/hooks/useRecordingStart';
import { cachedDeviceLabel } from '@/lib/audioDevices';
import { meetPreferencesKey, offerFor, parseMeetPreferences, updateEvidence, type Evidence, type MeetObservation } from '@/lib/googleMeetDetection';
import { recordingService } from '@/services/recordingService';

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

const suppressedKey = 'google-meet-suppressed-v1';
function readSuppressed(): Set<string> {
  try {
    const value = JSON.parse(read(suppressedKey) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter(v => typeof v === 'string') : []);
  } catch { return new Set(); }
}

export function MeetRecordingPanel() {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    try { setIsMac(platform() === 'macos'); } catch { /* Not in the desktop app. */ }
  }, []);
  return isMac ? <MacRecordingPanel /> : null;
}

function MacRecordingPanel() {
  const state = useRecordingState();
  const { selectedDevices } = useConfig();
  const { handleRecordingStart } = useRecordingStart(state.isRecording, () => {}, undefined, false);
  const [prefs, setPrefs] = useState(() => parseMeetPreferences(read(meetPreferencesKey)));
  const [sample, setSample] = useState<{ evidence: Evidence | null; now: number; observation?: MeetObservation | null }>({ evidence: null, now: 0 });
  const [probeError, setProbeError] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [suppressed, setSuppressed] = useState(readSuppressed);
  const [stopCancelled, setStopCancelled] = useState(() => read('google-meet-stop-cancelled-v1'));
  const [pending, setPending] = useState<'start' | 'stop' | 'pause' | null>(null);
  const inFlight = useRef(false);
  const lastJoined = useRef<string | null>(null);
  const alerted = useRef<string | null>(null);
  const browserOffer = useRef<{ key: string; nonce: string } | null>(null);
  const checkingExecute = useRef<string | null>(null);

  useEffect(() => () => { browserOffer.current = null; }, []);

  useEffect(() => {
    const refresh = () => setPrefs(parseMeetPreferences(read(meetPreferencesKey)));
    window.addEventListener(meetPreferencesKey, refresh);
    return () => window.removeEventListener(meetPreferencesKey, refresh);
  }, []);

  useEffect(() => {
    setSample({ evidence: null, now: 0 });
    setProbeError(false);
    if (!prefs.enabled) {
      void invoke('google_meet_probe', { enabled: false }).catch(console.error);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let evidence: Evidence | null = null;
    const poll = async () => {
      let observation: MeetObservation | null = null;
      let failed = false;
      try { observation = await invoke<MeetObservation | null>('google_meet_probe', { enabled: true }); }
      catch { failed = true; }
      if (!alive) return;
      const now = Date.now();
      evidence = updateEvidence(evidence, observation, now);
      if (observation?.phase === 'joined') lastJoined.current = observation.call;
      if (observation?.phase === 'ended' && lastJoined.current === observation.call) lastJoined.current = null;
      setSample({ evidence, now, observation });
      setProbeError(failed);
      timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [prefs.enabled]);

  function suppress(call: string) {
    if (suppressed.has(call)) return true;
    const next = new Set([...suppressed, call].slice(-64));
    setSuppressed(next);
    try { localStorage.setItem(suppressedKey, JSON.stringify([...next])); return true; }
    catch { return false; }
  }

  useEffect(() => {
    if (state.isRecording && lastJoined.current) suppress(lastJoined.current);
  }, [sample, state.isRecording]); // eslint-disable-line react-hooks/exhaustive-deps

  const finalizing = state.isStopping || state.isProcessing || state.isSaving || pending === 'stop';
  const statusError = state.status === RecordingStatus.ERROR ? state.statusMessage : undefined;
  const busy = finalizing || state.isStartingRecording || state.status === RecordingStatus.COMPLETED || pending !== null;
  const offer = offerFor(sample.evidence, sample.now, prefs, state.isRecording, busy, state.googleMeetOwner?.[0] ?? null,
    !!sample.evidence && suppressed.has(sample.evidence.call), state.googleMeetOwner?.[1] === stopCancelled);
  const key = offer && `${offer.call}:${offer.action}`;

  useEffect(() => {
    if (key && alerted.current !== key) {
      alerted.current = key;
      void invoke('google_meet_attention').catch(console.error);
    }
  }, [key]);

  function cancelStop(session: string) {
    setStopCancelled(session);
    try { localStorage.setItem('google-meet-stop-cancelled-v1', session); } catch { /* Keep the in-memory override. */ }
  }

  function withdrawBrowserOffer() {
    if (!browserOffer.current) return;
    browserOffer.current = null;
    void invoke('google_meet_countdown', { offer: null }).catch(console.error);
  }

  async function run(action: 'start' | 'stop' | 'pause', call?: string, automatic = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setControlError(null);
    setPending(action);
    try {
      if (action === 'start' && call) {
        if (!suppress(call) && automatic) throw new Error('Could not save the call override. Start manually instead.');
        await handleRecordingStart({ call, automatic });
      } else if (action === 'stop') {
        if (call) {
          const owner = state.googleMeetOwner;
          if (owner?.[0] !== call) return;
          cancelStop(owner[1]); // Do not retry against uncertain or changed evidence.
          const result = await invoke<string>('stop_recording_for_google_meet', { call, start: owner[1] });
          if (result === 'not_active') toast.info('Could not confirm the call ended. Stop manually if needed.');
        } else {
          if (lastJoined.current) suppress(lastJoined.current);
          if (await recordingService.stopRecording('') === 'stopped') await emit('recording-stop-complete', true);
        }
      } else if (action === 'pause') {
        if (state.isPaused) await recordingService.resumeRecording();
        else await recordingService.pauseRecording();
      }
    } catch (err) {
      toast.error(`Could not ${action} recording`, { description: String(err) });
      if (action === 'stop') {
        setControlError('Could not finish saving the recording. Check the recording folder and restart Meetily if needed.');
        state.setStatus(RecordingStatus.ERROR);
      }
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  useEffect(() => {
    if (!key || !offer || offer.action === 'prompt') {
      withdrawBrowserOffer();
      return;
    }
    const recordingAction = offer.action;
    const armedKey = `${key}:${recordingAction === 'stop' ? state.googleMeetOwner?.[1] : ''}`;
    if (browserOffer.current?.key !== armedKey) browserOffer.current = { key: armedKey, nonce: crypto.randomUUID() };
    const { nonce } = browserOffer.current;
    const phase = recordingAction === 'start' ? 'joined' : 'ended';
    const observation = sample.observation;
    if (observation?.call === offer.call && observation.phase === phase && observation.response?.[0] === nonce) {
      const action = observation.response[1];
      const consume = () => {
        if (browserOffer.current?.nonce !== nonce || inFlight.current) return;
        withdrawBrowserOffer();
        if (action === 'cancel') {
          if (recordingAction === 'stop' && state.googleMeetOwner) cancelStop(state.googleMeetOwner[1]);
          else suppress(offer.call);
        } else {
          void run(recordingAction, offer.call, action === 'execute');
        }
      };
      if (action !== 'execute') {
        consume();
      } else {
        if (checkingExecute.current === nonce) return;
        checkingExecute.current = nonce;
        // A poll can have cached execute just before Chrome revoked it on blur.
        void invoke<boolean>('google_meet_confirm_execute', { offer: { call: offer.call, nonce, phase } })
          .then(confirmed => { if (confirmed) consume(); })
          .catch(console.error)
          .finally(() => { if (checkingExecute.current === nonce) checkingExecute.current = null; });
      }
      return;
    }
    void invoke('google_meet_countdown', { offer: { call: offer.call, nonce, phase } }).catch(console.error);
  }, [key, sample, state.googleMeetOwner]); // eslint-disable-line react-hooks/exhaustive-deps

  const showSources = state.isRecording && !finalizing;
  if (!offer && !showSources && !finalizing && !state.isStartingRecording && !probeError && !controlError && !statusError) return null;
  const active = Math.floor(state.activeDuration ?? 0);
  const duration = `${String(Math.floor(active / 60)).padStart(2, '0')}:${String(active % 60).padStart(2, '0')}`;
  const source = (name: string | null | undefined, available: boolean | undefined) =>
    `${name ? cachedDeviceLabel(name) : 'Default'} configured | ${available === undefined ? 'checking' : available ? 'stream open' : 'unavailable'}`;
  return (
    <aside aria-label="Meetily recording controls" className="fixed bottom-5 right-5 z-40 w-[min(24rem,calc(100vw-2.5rem))] space-y-2 rounded-lg border bg-background p-3 text-sm text-foreground shadow-lg">
      {finalizing && <p role="status" className="font-medium">Finalizing recording and transcript...</p>}
      {!finalizing && state.isStartingRecording && <p role="status">Starting recording...</p>}
      {showSources && <>
        <div className="flex items-center gap-2 font-medium">
          <span aria-hidden className={`size-2 rounded-full ${state.isPaused ? 'bg-amber-500' : 'bg-red-500'}`} />
          {state.isPaused ? 'Paused' : 'Recording'} <span className="ml-auto tabular-nums">{duration}</span>
        </div>
        <p className="break-words">Microphone: {source(selectedDevices?.micDevice, state.microphoneAvailable)}</p>
        <p className="break-words">System audio: {source(selectedDevices?.systemDevice, state.systemAvailable)}</p>
        {state.audioWarning && <p role="status" className="text-destructive">{state.audioWarning}. Some audio may be missing.</p>}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run('pause')}>{state.isPaused ? 'Resume' : 'Pause'}</Button>
          {offer?.action !== 'stop' && <Button size="sm" variant="destructive" disabled={busy} onClick={() => void run('stop')}>Stop</Button>}
        </div>
      </>}
      {offer && <div className="space-y-2">
        <p role="status" className="font-medium">{offer.action === 'stop' ? 'Google Meet call ended' : 'Google Meet call detected'}</p>
        {offer.action !== 'stop' && <p className="text-muted-foreground">Not recording. Only record with participants&apos; consent.</p>}
        {offer.action !== 'prompt' && <p>Countdown is shown in the foreground Meet tab.</p>}
        <div className="flex gap-2">
          <Button size="sm" variant={offer.action === 'stop' ? 'destructive' : 'default'} onClick={() => void run(offer.action === 'stop' ? 'stop' : 'start', offer.call)}>
            {offer.action === 'stop' ? 'Stop now' : offer.action === 'start' ? 'Start now' : 'Start recording'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => {
            withdrawBrowserOffer();
            if (offer.action === 'stop' && state.googleMeetOwner) cancelStop(state.googleMeetOwner[1]);
            else suppress(offer.call);
          }}>
            {offer.action === 'prompt' ? 'Dismiss' : 'Cancel'}
          </Button>
        </div>
      </div>}
      {probeError && <p role="status" className="text-destructive">Could not check Google Meet. Use manual recording controls.</p>}
      {controlError && <p role="alert" className="text-destructive">{controlError}</p>}
      {statusError && <p role="alert" className="text-destructive">{statusError}</p>}
    </aside>
  );
}
