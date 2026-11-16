"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { TranscriptEditor } from './TranscriptEditor';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { useMemo, useState, useEffect, useRef } from 'react';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  isSummaryGenerating?: boolean;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
  onTranscriptChange?: () => void;
}

export function TranscriptPanel({
  transcripts,
  isSummaryGenerating = false,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
  onEditingChange,
  onTranscriptChange,
}: TranscriptPanelProps) {
  const [editing, setEditing] = useState<TranscriptSegmentData | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onEditingChange?.(editing !== null); }, [editing, onEditingChange]);
  async function refetch() {
    onTranscriptChange?.();
    await onRefetchTranscripts?.();
  }
  async function save(text: string) {
    if (!editing || !meetingId) return;
    await invoke('api_update_transcript', { meetingId, transcriptId: editing.id, originalText: editing.text, text });
    if (!mounted.current) return;
    setEdits(current => ({ ...current, [editing.id]: text }));
    toast.success('Transcript saved. Regenerate the summary to include corrections.');
    try { await refetch(); }
    catch { toast.warning('Transcript saved. Reopen this meeting to refresh the transcript.'); }
  }
  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments.map(segment => edits[segment.id] === undefined ? segment : { ...segment, text: edits[segment.id] });
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: edits[t.id] ?? t.text,
      confidence: t.confidence,
    }));
  }, [transcripts, usePagination, segments, edits]);

  return (
    <div className="flex h-full min-w-0 w-full bg-white flex-col relative @container">
      {/* Title area */}
      <div className="p-4 border-b border-gray-200">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={refetch}
        />
      </div>

      {/* Transcript content - use virtualized view for better performance */}
      <div className="flex-1 min-h-0 overflow-hidden pb-4">
        <VirtualizedTranscriptView
          segments={convertedSegments}
          onEdit={meetingId && !isRecording && !isSummaryGenerating ? setEditing : undefined}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
        />
      </div>

      {editing && <TranscriptEditor key={editing.id} segment={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}
