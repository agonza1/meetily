'use client';

import { useEffect, useState } from 'react';
import { platform } from '@tauri-apps/plugin-os';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { meetPreferencesKey, parseMeetPreferences, type MeetPreferences } from '@/lib/googleMeetDetection';

export function GoogleMeetSettings() {
  const [preferences, setPreferences] = useState<MeetPreferences | null>(null);
  useEffect(() => {
    try {
      if (platform() === 'macos') setPreferences(parseMeetPreferences(localStorage.getItem(meetPreferencesKey)));
    } catch { /* Browser or unavailable desktop storage. */ }
  }, []);
  if (!preferences) return null;

  function update(key: keyof MeetPreferences, value: boolean) {
    const updated = { ...preferences!, [key]: value };
    try {
      localStorage.setItem(meetPreferencesKey, JSON.stringify(updated));
      setPreferences(updated);
      window.dispatchEvent(new Event(meetPreferencesKey));
    } catch {
      toast.error('Could not save Google Meet preferences');
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="meet-detection-heading">
      <h4 id="meet-detection-heading" className="font-medium">Google Meet detection (experimental)</h4>
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
    </section>
  );
}
