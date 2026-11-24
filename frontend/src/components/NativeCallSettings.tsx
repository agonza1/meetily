import { Switch } from '@/components/ui/switch';
import type { NativePrefs } from '@/lib/nativeCallDetection';

export function NativeCallSettings({ prefs, status, update }: {
  prefs: NativePrefs; status: string; update: (key: keyof NativePrefs, value: boolean) => void;
}) {
  return <section className="space-y-2 rounded-lg border bg-background p-3 text-sm">
    <h3 className="font-medium">App-independent call detection</h3>
    <p>Uses app audio stream activity, not audio content. Replaces Google Meet detection while enabled. Only record with consent.</p>
    <label className="flex items-center justify-between gap-2">Detect possible calls
      <Switch checked={prefs.enabled} onCheckedChange={v => update('enabled', v)} /></label>
    <label className="flex items-center justify-between gap-2">Start after visible countdown
      <Switch disabled={!prefs.enabled} checked={prefs.autoStart} onCheckedChange={v => update('autoStart', v)} /></label>
    <p role="status">{status}</p>
  </section>;
}
