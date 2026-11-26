'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { NativeCallSettings } from './NativeCallSettings';
import { getNativeStatus, nativeKey, parseNative, saveNative, subscribeNativeStatus } from '@/lib/nativeCallDetection';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { isMacRecordingCompanion } from '@/lib/recordingCompanion';
import { meetPreferencesKey, parseMeetPreferences, type MeetPreferences } from '@/lib/googleMeetDetection';

export function saveGoogleMeetPreference(key: keyof MeetPreferences, value: boolean) {
  const current = parseMeetPreferences(localStorage.getItem(meetPreferencesKey));
  if (key !== 'enabled' && !current.enabled) return;
  localStorage.setItem(meetPreferencesKey, JSON.stringify({ ...current, [key]: value }));
  window.dispatchEvent(new Event(meetPreferencesKey));
}

export function GoogleMeetSettings() {
  const [native, setNative] = useState(() => parseNative(null));
  const status = useSyncExternalStore(subscribeNativeStatus, getNativeStatus, getNativeStatus);
  const [preferences, setPreferences] = useState<MeetPreferences | null>(null);
  useEffect(() => {
    try {
      if (!isMacRecordingCompanion()) return;
      const refresh = () => {
        try {
          setPreferences(parseMeetPreferences(localStorage.getItem(meetPreferencesKey)));
          setNative(parseNative(localStorage.getItem(nativeKey)));
        } catch { /* Unavailable desktop storage. */ }
      };
      refresh();
      window.addEventListener(meetPreferencesKey, refresh);
      window.addEventListener(nativeKey, refresh);
      return () => { window.removeEventListener(meetPreferencesKey, refresh); window.removeEventListener(nativeKey, refresh); };
    } catch { /* Browser or unavailable desktop storage. */ }
  }, []);
  if (!preferences) return null;

  function update(key: keyof MeetPreferences, value: boolean) {
    try {
      saveGoogleMeetPreference(key, value);
    } catch {
      toast.error('Could not save Google Meet preferences');
    }
  }

  return (
    <><NativeCallSettings prefs={native} status={status} update={(key, value) => {
      try { saveNative(key, value); } catch { toast.error('Could not save call preferences'); }
    }} /><section className="space-y-3 rounded-lg border p-4" aria-labelledby="meet-detection-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="meet-detection-heading" className="font-medium">Google Meet detection (experimental)</h4>
        <Button type="button" size="sm" variant="outline" onClick={() => {
          void invoke('open_recording_companion')
            .catch(() => toast.error('Could not open the menu-bar panel'));
        }}>
          Open menu-bar panel
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Requires Google Chrome in English and the optional Meetily Chrome integration. With detection alone, recording never starts without your approval.</p>
      <div className="flex items-center justify-between gap-4">
        <span id="meet-enabled">Detect joined calls</span>
        <Switch aria-labelledby="meet-enabled" checked={preferences.enabled} onCheckedChange={value => update('enabled', value)} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span id="meet-start">Start automatically after a countdown</span>
        <Switch aria-labelledby="meet-start" disabled={!preferences.enabled} checked={preferences.autoStart} onCheckedChange={value => update('autoStart', value)} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span id="meet-stop">Stop automatically after leaving an automatically recorded call</span>
        <Switch aria-labelledby="meet-stop" disabled={!preferences.enabled} checked={preferences.autoStop} onCheckedChange={value => update('autoStop', value)} />
      </div>
      <p className="text-sm text-muted-foreground">Countdowns run in the visible, focused Meet tab. Get participants&apos; consent before recording.</p>
    </section></>
  );
}
