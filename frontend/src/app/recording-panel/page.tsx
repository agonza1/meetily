'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AudioLines, CircleAlert, LoaderCircle, Mic, Pause, Play, Settings, Square, Volume2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { NativeCallSettings } from '@/components/NativeCallSettings';
import {
  COMPANION_ACTION,
  COMPANION_REQUEST,
  COMPANION_SNAPSHOT,
  COMPANION_WINDOW,
  type CompanionAction,
  type CompanionSnapshot,
} from '@/lib/recordingCompanion';

const phases = {
  idle: { label: 'Ready to record', color: 'bg-slate-400' },
  starting: { label: 'Starting recording…', color: 'bg-blue-500' },
  recording: { label: 'Recording', color: 'bg-red-500' },
  paused: { label: 'Paused', color: 'bg-amber-500' },
  saving: { label: 'Saving recording…', color: 'bg-blue-500' },
  error: { label: 'Recording needs attention', color: 'bg-red-500' },
} satisfies Record<CompanionSnapshot['phase'], { label: string; color: string }>;

const preferences = [
  { key: 'enabled', label: 'Detect joined calls' },
  { key: 'autoStart', label: 'Start automatically' },
  { key: 'autoStop', label: 'Stop automatically' },
] as const;

const offers = {
  prompt: { title: 'Google Meet detected', detail: '', action: 'Start recording', dismiss: 'Dismiss' },
  start: { title: 'Automatic start', detail: 'Countdown in the active Meet tab.', action: 'Start now', dismiss: 'Cancel' },
  stop: { title: 'Automatic stop', detail: 'Countdown in the active Meet tab.', action: 'Stop now', dismiss: 'Cancel' },
};

function formatElapsed(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const format = (part: number) => String(part).padStart(2, '0');

  return hours ? `${hours}:${format(minutes)}:${format(total % 60)}` : `${format(minutes)}:${format(total % 60)}`;
}

function hidePanel() {
  void getCurrentWindow().hide().catch(console.error);
}

function AudioSource({ kind, device, available }: {
  kind: 'microphone' | 'system';
  device: string;
  available?: boolean;
}) {
  const Icon = kind === 'microphone' ? Mic : Volume2;
  const label = kind === 'microphone' ? 'Microphone' : 'System audio';
  return (
    <div className="flex min-w-0 items-center gap-2.5 py-1.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[11px] font-medium text-slate-500">{label}</div>
        <div className="truncate text-sm text-slate-900" title={device}>{device || 'Default'}</div>
      </div>
      {available !== undefined && (
        <span className={`shrink-0 text-[11px] font-medium ${available ? 'text-emerald-700' : 'text-red-700'}`}>
          {available ? 'Stream open' : 'Unavailable'}
        </span>
      )}
    </div>
  );
}

export default function RecordingCompanionPage() {
  const [snapshot, setSnapshot] = useState<CompanionSnapshot | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [deliveryError, setDeliveryError] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const request = () => void emitTo('main', COMPANION_REQUEST).catch(console.error);
    const timeout = window.setTimeout(() => setWaiting(false), 1800);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hidePanel();
    };

    void listen<CompanionSnapshot>(COMPANION_SNAPSHOT, ({ payload }) => {
      if (!disposed) {
        setSnapshot(payload);
        setWaiting(false);
      }
    }, { target: COMPANION_WINDOW }).then(removeListener => {
      if (disposed) {
        removeListener();
        return;
      }
      unlisten = removeListener;
      request();
      window.addEventListener('focus', request);
    }).catch(() => {
      if (!disposed) setWaiting(false);
    });

    window.addEventListener('keydown', onKeyDown);
    return () => {
      disposed = true;
      unlisten?.();
      window.clearTimeout(timeout);
      window.removeEventListener('focus', request);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function send(action: CompanionAction) {
    setDeliveryError(false);
    void emitTo('main', COMPANION_ACTION, action).catch(() => setDeliveryError(true));
  }

  const phase = snapshot ? phases[snapshot.phase] : null;
  const active = snapshot?.phase === 'recording' || snapshot?.phase === 'paused';
  const transitioning = snapshot?.phase === 'starting' || snapshot?.phase === 'saving';
  const offer = snapshot?.offer ? offers[snapshot.offer] : null;

  return (
    <main className="h-screen overflow-y-auto bg-slate-50 text-slate-950">
      <header className="flex h-[54px] items-center gap-2.5 border-b border-slate-200 bg-white px-4">
        <div aria-hidden className="grid size-8 place-items-center rounded-lg bg-slate-900 text-white">
          <AudioLines className="size-[17px]" />
        </div>
        <h1 className="flex-1 text-base font-semibold tracking-tight">Meetily</h1>
        <Button type="button" size="sm" variant="ghost" disabled={!snapshot} onClick={() => send({ type: 'settings' })}>
          <Settings aria-hidden className="size-4" /> Settings
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-7 text-slate-500" aria-label="Close recording panel" onClick={hidePanel}>
          <X aria-hidden />
        </Button>
      </header>

      {snapshot && phase ? (
        <div className="space-y-3 p-4">
          <section aria-label="Recording" className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div role="status" className="flex min-w-0 items-center gap-2 text-base font-semibold">
                {transitioning ? (
                  <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-blue-600 motion-reduce:animate-none" />
                ) : <span aria-hidden className={`size-2 shrink-0 rounded-full ${phase.color}`} />}
                {phase.label}
              </div>
              {(active || snapshot.phase === 'saving') && (
                <span aria-label="Elapsed recording time" className="font-mono text-sm font-medium tabular-nums text-slate-600">{formatElapsed(snapshot.elapsedSeconds)}</span>
              )}
            </div>
            {snapshot.message && <p className="break-words text-xs leading-snug text-slate-600">{snapshot.message}</p>}
            {active && (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" className="flex-1" disabled={snapshot.busy} onClick={() => send({ type: snapshot.phase === 'paused' ? 'resume' : 'pause' })}>
                  {snapshot.phase === 'paused' ? <><Play aria-hidden /> Resume</> : <><Pause aria-hidden /> Pause</>}
                </Button>
                {snapshot.offer !== 'stop' && (
                  <Button type="button" size="sm" variant="destructive" className="flex-1" disabled={snapshot.busy} onClick={() => send({ type: 'stop' })}>
                    <Square aria-hidden /> Stop
                  </Button>
                )}
              </div>
            )}
            {snapshot.nativeFamily !== null && <div className="space-y-2"><p>Possible call detected. {snapshot.nativeStatus}</p>
              <Button onClick={() => send({ type: 'native-offer', family: snapshot.nativeFamily!, record: true })}>Start recording</Button>
              <Button variant="outline" onClick={() => send({ type: 'native-offer', family: snapshot.nativeFamily!, record: false })}>Cancel</Button>
            </div>}
            {!active && !transitioning && !offer && snapshot.nativeFamily === null && (
              <Button type="button" size="sm" variant="destructive" className="w-full" disabled={snapshot.busy} onClick={() => send({ type: 'start' })}>
                <Mic aria-hidden /> Start recording
              </Button>
            )}
            {offer && (
              <div className="rounded-lg bg-blue-50 p-2.5">
                <div role="status" className="text-sm font-semibold text-blue-950">{offer.title}</div>
                {offer.detail && <p className="mt-0.5 text-xs text-blue-900">{offer.detail}</p>}
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" className="flex-1" disabled={snapshot.busy} onClick={() => send({ type: 'accept-offer' })}>{offer.action}</Button>
                  <Button type="button" size="sm" variant="outline" disabled={snapshot.busy} onClick={() => send({ type: 'dismiss-offer' })}>{offer.dismiss}</Button>
                </div>
              </div>
            )}
            {deliveryError && (
              <div role="alert" className="flex items-start gap-1.5 text-xs text-red-700">
                <CircleAlert aria-hidden className="size-3.5 shrink-0" /> Could not reach Meetily. Try opening the panel again.
              </div>
            )}
          </section>

          <section aria-label="Audio sources" className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-3 py-0.5">
            <AudioSource kind="microphone" device={snapshot.microphone} available={active ? snapshot.microphoneAvailable : undefined} />
            <AudioSource kind="system" device={snapshot.systemAudio} available={active ? snapshot.systemAvailable : undefined} />
          </section>

          <section aria-labelledby="companion-meet-heading" className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
            <h2 id="companion-meet-heading" className="mb-1 text-sm font-semibold">Google Meet</h2>
            {preferences.map(({ key, label }) => (
              <label key={key} className="flex min-h-8 items-center justify-between gap-3 text-sm text-slate-700">
                {label}
                <Switch
                  checked={snapshot.preferences[key]}
                  disabled={key !== 'enabled' && !snapshot.preferences.enabled}
                  onCheckedChange={value => send({ type: 'preference', key, value })}
                />
              </label>
            ))}
          </section>
          <NativeCallSettings prefs={snapshot.native} status={snapshot.nativeStatus} update={(key, value) => send({ type: 'native-preference', key, value })} />
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
            {waiting && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
            {waiting ? 'Connecting to Meetily…' : 'Open Meetily to finish setup or reconnect.'}
          </p>
          {!waiting && (
            <Button type="button" size="sm" variant="outline" onClick={() => {
              setDeliveryError(false);
              void invoke('open_recording_companion_settings').catch(() => setDeliveryError(true));
            }}>
              Open Meetily
            </Button>
          )}
          {deliveryError && <p role="alert" className="text-xs text-red-700">Could not open Meetily.</p>}
        </div>
      )}
    </main>
  );
}
