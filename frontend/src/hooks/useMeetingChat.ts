import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  boundedChatHistory, chatByteLength,
  type ChatConfiguration, type ChatMessage, type ChatRequest, type ChatResponse,
} from '../lib/meeting-chat';

export type ChatTransport = {
  configuration: () => Promise<ChatConfiguration>;
  ask: (request: ChatRequest) => Promise<ChatResponse>;
};
const nativeTransport: ChatTransport = {
  configuration: () => invoke('api_get_meeting_chat_config'),
  ask: (request) => invoke('api_ask_meetings_ai', { ...request }),
};
type Snapshot = {
  scope: string | null;
  configuration: ChatConfiguration | null;
  messages: ChatMessage[];
  pending: boolean;
  error: string | null;
};
const empty = (scope: string | null): Snapshot => ({ scope, configuration: null, messages: [], pending: false, error: null });

export function useMeetingChat(meetingId: string | null, open: boolean, transport: ChatTransport = nativeTransport) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => empty(meetingId));
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const version = ++epoch.current;
    busy.current = false;
    setSnapshot(empty(meetingId));
    if (open && meetingId) {
      void transport.configuration().then(configuration => {
        if (epoch.current === version) setSnapshot(current => ({ ...current, configuration }));
      }).catch(() => {
        if (epoch.current === version) setSnapshot(current => ({ ...current, error: 'Could not load the selected model. Check Settings or retry.' }));
      });
    }
    return () => { epoch.current++; };
  }, [meetingId, open, refresh, transport]);

  const reset = useCallback(() => {
    epoch.current++;
    busy.current = false;
    setSnapshot(empty(meetingId));
    setRefresh(value => value + 1);
  }, [meetingId]);

  const send = async (question: string, allowProviderRequest = false) => {
    const query = question.trim();
    if (!open || !meetingId || snapshot.scope !== meetingId || !snapshot.configuration || busy.current) return false;
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
    busy.current = true;
    setSnapshot(current => ({ ...current, pending: true, error: null, messages: [...current.messages, { role: 'user', content: query }] }));
    try {
      const response = await transport.ask({
        query, meetingId, historyMeetingId: meetingId,
        history: boundedChatHistory(snapshot.messages),
        configurationId: configuration.configurationId, allowProviderRequest,
      });
      if (epoch.current !== version) return true;
      if (response.meetingId !== meetingId || response.provider !== configuration.provider || response.model !== configuration.model) {
        throw new Error('Unexpected response scope');
      }
      setSnapshot(current => ({ ...current, messages: [...current.messages, {
        role: 'assistant', content: response.answer,
        model: `${response.provider} · ${response.model}`, contextTruncated: response.contextTruncated,
      }] }));
    } catch (error) {
      if (epoch.current === version) {
        // Native command errors are content-free; do not log questions, transcripts or raw provider errors.
        const message = typeof error === 'string' ? error : 'Could not generate a reply for this meeting. Try again.';
        setSnapshot(current => ({ ...current, error: message }));
      }
    } finally {
      if (epoch.current === version) {
        busy.current = false;
        setSnapshot(current => ({ ...current, pending: false }));
      }
    }
    return true;
  };
  // Hide old scope data during the render before the cleanup effect runs.
  const visible = open && snapshot.scope === meetingId ? snapshot : empty(meetingId);
  return { ...visible, send, reset };
}
