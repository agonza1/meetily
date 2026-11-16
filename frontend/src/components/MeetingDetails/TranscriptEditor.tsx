"use client";
import { useState } from 'react';
import type { TranscriptSegmentData } from '@/types';

export function TranscriptEditor({ segment, onSave, onCancel }: {
  segment: TranscriptSegmentData;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(segment.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return <form aria-label="Edit transcript" className="shrink-0 border-t border-gray-200 p-3 space-y-2" onSubmit={async event => {
    event.preventDefault();
    if (saving || !draft.trim()) return;
    if (draft === segment.text) { onCancel(); return; }
    setSaving(true); setError('');
    try { await onSave(draft); onCancel(); }
    catch (reason) { setError(typeof reason === 'string' ? reason : 'Could not save the transcript. Try again.'); }
    finally { setSaving(false); }
  }}>
    <label className="block text-sm font-semibold" htmlFor="transcript-edit">Edit transcript · {Math.floor(segment.timestamp / 60)}:{Math.floor(segment.timestamp % 60).toString().padStart(2, '0')}</label>
    <textarea id="transcript-edit" aria-label="Transcript text" autoFocus rows={5} value={draft} disabled={saving} onChange={event => setDraft(event.target.value)} className="w-full rounded-lg border p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    <p className="text-xs text-gray-500">Saving keeps this timestamp and clears saved chat. Regenerate the summary to include corrections.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex justify-end gap-2">
      <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-3 py-1.5 text-sm">Cancel</button>
      <button type="submit" disabled={saving || !draft.trim()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save transcript'}</button>
    </div>
  </form>;
}
