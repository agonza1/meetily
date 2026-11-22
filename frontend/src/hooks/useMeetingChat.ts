import { useCallback, useEffect, useRef, useState } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import {
  boundedChatHistory, chatByteLength,
  type ChatConfiguration, type ChatMessage, type ChatRequest, type ChatResponse, type ChatHistory, type ChatSource,
} from '../lib/meeting-chat';

export type ChatTransport = {
  configuration: () => Promise<ChatConfiguration>;
  history: (meetingId: string) => Promise<ChatHistory>;
  clear: (meetingId: string) => Promise<ChatHistory>;
  ask: (request: ChatRequest, onMatches: (matches: ChatSource[]) => void) => Promise<ChatResponse>;
  cancel?: (requestId: string) => Promise<void>;
};
const nativeTransport: ChatTransport = {
  configuration: () => invoke('api_get_meeting_chat_config'),
  history: meetingId => invoke('api_get_meeting_chat_history', { meetingId }),
  clear: meetingId => invoke('api_clear_meeting_chat_history', { meetingId }),
  cancel: requestId => invoke('api_cancel_meeting_chat', { requestId }),
  ask: (request, onMatches) => invoke('api_ask_meetings_ai', {
    ...request, onMatches: new Channel(onMatches),
  }),
};
type Snapshot = {
  scope: string | null;
  configuration: ChatConfiguration | null;
  messages: ChatMessage[];
  revision: number | null;
  pending: boolean;
  matches: ChatSource[];
  error: string | null;
};
const empty = (scope: string | null): Snapshot => ({ scope, configuration: null, messages: [], revision: null, pending: false, matches: [], error: null });

export function useMeetingChat(meetingId: string | null, open: boolean, transport: ChatTransport = nativeTransport) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => empty(meetingId));
  const [loadVersion, setLoadVersion] = useState(0);
  const epoch = useRef(0);
  const busy = useRef(false);
  const active = useRef<string | null>(null);
  const cancelActive = useCallback(async () => {
    const requestId = active.current;
    active.current = null;
    try { if (requestId) await transport.cancel?.(requestId); return true; }
    catch { return false; }
  }, [transport]);
  useEffect(() => {
    const version = ++epoch.current;
    busy.current = false;
    setSnapshot(empty(meetingId));
    if (open && meetingId) {
      void Promise.allSettled([transport.configuration(), transport.history(meetingId)]).then(([configuration, restored]) => {
        if (restored.status === 'rejected') throw new Error('History could not be read');
        const history = restored.value;
        if (history.meetingId !== meetingId || !Number.isSafeInteger(history.revision) || history.revision < 0) throw new Error('Unexpected history scope');
        if (epoch.current === version) setSnapshot(current => ({ ...current, messages: history.messages, revision: history.revision,
          configuration: configuration.status === 'fulfilled' ? configuration.value : null,
          error: configuration.status === 'rejected' ? 'Saved chat loaded. Choose a model in Settings to continue.' : null }));
      }).catch(() => {
        if (epoch.current === version) setSnapshot(current => ({ ...current, error: 'Could not load saved chat or model settings. Reopen this meeting to retry.' }));
      });
    }
    return () => { epoch.current++; cancelActive(); };
  }, [meetingId, open, transport, cancelActive, loadVersion]);

  const reset = useCallback(async () => {
    const version = ++epoch.current;
    cancelActive();
    busy.current = false;
    setSnapshot(empty(meetingId));
    if (!meetingId || !open) return;
    try {
      const [configuration, cleared] = await Promise.allSettled([transport.configuration(), transport.clear(meetingId)]);
      if (cleared.status === 'rejected') throw new Error('Clear failed');
      const history = cleared.value;
      if (history.meetingId !== meetingId || !Number.isSafeInteger(history.revision) || history.revision < 0 || history.messages.length) throw new Error('Unexpected clear result');
      if (epoch.current === version) setSnapshot({ ...empty(meetingId), revision: history.revision,
        configuration: configuration.status === 'fulfilled' ? configuration.value : null,
        error: configuration.status === 'rejected' ? 'Saved chat cleared. Could not load model settings; reopen this meeting to retry.' : null });
    } catch {
      if (epoch.current === version) setSnapshot(current => ({ ...current, error: 'Could not clear saved chat. Reopen this meeting to reload it.' }));
    }
  }, [meetingId, open, transport, cancelActive]);

  const send = async (question: string, allowProviderRequest = false) => {
    const query = question.trim();
    if (!open || !meetingId || snapshot.scope !== meetingId || !snapshot.configuration || snapshot.revision === null || busy.current) return false;
    if (!query || chatByteLength(query) > 4_000) {
      setSnapshot(current => ({ ...current, error: 'Enter a question, or shorten it before trying again.' }));
      return false;
    }
    if (snapshot.configuration.requiresProviderConfirmation && !allowProviderRequest) {
      setSnapshot(current => ({ ...current, error: 'Confirm sending transcript text to the configured provider for this question.' }));
      return false;
    }
    const version = epoch.current;
    const configuration = snapshot.configuration;
    const historyRevision = snapshot.revision;
    const requestId = crypto.randomUUID();
    active.current = requestId;
    busy.current = true;
    setSnapshot(current => ({ ...current, pending: true, matches: [], error: null, messages: [...current.messages, { id: `${requestId}-user`, role: 'user', content: query, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }] }));
    try {
      const response = await transport.ask({
        requestId, historyRevision, query, meetingId, historyMeetingId: meetingId,
        history: boundedChatHistory(snapshot.messages),
        configurationId: configuration.configurationId, allowProviderRequest,
      }, matches => {
        if (epoch.current === version && active.current === requestId) {
          setSnapshot(current => ({ ...current, matches }));
        }
      });
      if (epoch.current !== version) return true;
      if (response.meetingId !== meetingId || response.provider !== configuration.provider || response.model !== configuration.model || response.historyRevision !== historyRevision + 1) {
        throw new Error('Unexpected response scope');
      }
      setSnapshot(current => ({ ...current, messages: [...current.messages, {
        id: `${requestId}-assistant`, role: 'assistant' as const, content: response.answer, timestamp: response.createdAt,
        model: `${response.provider} · ${response.model}`, contextTruncated: response.contextTruncated, sources: response.sources,
      }].slice(-40), revision: response.historyRevision }));
    } catch (error) {
      if (epoch.current === version) {
        // Native command errors are content-free; do not log questions, transcripts or raw provider errors.
        const message = typeof error === 'string' ? error : 'Could not generate a reply for this meeting. Try again.';
        setSnapshot(current => ({ ...current, error: message }));
      }
    } finally {
      if (active.current === requestId) active.current = null;
      if (epoch.current === version) {
        busy.current = false;
        setSnapshot(current => ({ ...current, pending: false, matches: [] }));
      }
    }
    return true;
  };
  // Hide old scope data during the render before the cleanup effect runs.
  const visible = open && snapshot.scope === meetingId ? snapshot : empty(meetingId);
  const stop = async () => {
    const version = ++epoch.current;
    const cancellation = cancelActive();
    busy.current = false;
    // Preserve the editable draft while reloading any exchange that completed before Stop.
    setSnapshot(current => ({ ...current, pending: false, matches: [], revision: null, error: null }));
    if (!meetingId) return;
    try {
      if (!await cancellation) throw new Error('Cancellation failed');
      const history = await transport.history(meetingId);
      if (history.meetingId !== meetingId || !Number.isSafeInteger(history.revision) || history.revision < 0) throw new Error('Unexpected history scope');
      if (epoch.current === version) setSnapshot(current => ({ ...current, messages: history.messages, revision: history.revision }));
    } catch {
      if (epoch.current === version) setSnapshot(current => ({ ...current, error: 'Could not reload saved chat after stopping. Reopen this meeting to retry.' }));
    }
  };
  return { ...visible, send, reset, stop, reload: () => setLoadVersion(version => version + 1) };
}
