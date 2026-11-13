"use client";

// Selected-meeting UI adapted from shareefmx's AskMeetingsModal in PR #810 (MIT).
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, RotateCcw, Send, Settings } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { useMeetingChat, type ChatTransport } from '../hooks/useMeetingChat';

type Meeting = { id: string; title: string };
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentMeetingId: string | null;
  meetings: Meeting[];
};

export function MeetingChatConversation({ currentMeetingId, meetings, onOpenChange, transport }: Omit<Props, 'open'> & { transport?: ChatTransport }) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentMeetingId ?? '');
  const meetingId = meetings.some(meeting => meeting.id === selected) ? selected : null;
  const chat = useMeetingChat(meetingId, true, transport);
  const [draft, setDraft] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const submissionEpoch = useRef(0);
  useEffect(() => {
    submissionEpoch.current++;
    setDraft(''); setConfirmed(false);
    return () => { submissionEpoch.current++; };
  }, [meetingId, chat.configuration?.configurationId]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [chat.messages.length, chat.pending]);
  async function submit() {
    const version = submissionEpoch.current;
    if (await chat.send(draft, confirmed) && submissionEpoch.current === version) { setDraft(''); setConfirmed(false); }
  }
  return <>
    <label className="text-sm font-medium" htmlFor="meeting-chat-scope">Meeting</label>
    <select id="meeting-chat-scope" className="w-full rounded-md border p-2 text-sm" value={meetingId ?? ''} onChange={event => setSelected(event.target.value)}>
      <option value="">Choose a meeting</option>
      {meetings.map(meeting => <option key={meeting.id} value={meeting.id}>{meeting.title}</option>)}
    </select>
    {chat.configuration && <p className="text-xs text-gray-600">
      {chat.configuration.provider} · {chat.configuration.model} · {chat.configuration.requiresProviderConfirmation ? 'Configured provider endpoint' : 'On this Mac'}
    </p>}
    <div className="min-h-48 max-h-[40vh] overflow-y-auto rounded-md bg-gray-50 p-3 space-y-4" role="log" aria-label="Meeting conversation" aria-live="polite" aria-relevant="additions">
      {!chat.messages.length && <p className="text-sm text-gray-500">{meetingId ? 'Ask about decisions, action items, or topics in this meeting.' : 'Choose one meeting to start a conversation.'}</p>}
      {chat.messages.map((message, index) => <article key={index} className={`rounded-lg p-3 text-sm ${message.role === 'user' ? 'bg-blue-50' : 'border bg-white'}`}>
        <p className="mb-2 text-xs font-medium text-gray-500">{message.role === 'user' ? 'You' : 'Meetily'}</p>
        <MeetingChatAnswer content={message.content} />
        {message.model && <p className="mt-2 text-xs text-gray-500">{message.model}</p>}
        {message.contextTruncated && <p className="mt-2 text-xs text-amber-800">Only part of the transcript was included. Check the transcript for omitted details.</p>}
      </article>)}
      {chat.pending && <p className="text-sm text-gray-500" role="status">Generating a reply…</p>}
      <div ref={end} />
    </div>
    {chat.error && <div role="alert" className="rounded border border-red-200 p-2 text-sm text-red-800">{chat.error}</div>}
    {chat.configuration?.requiresProviderConfirmation && <label className="flex items-start gap-2 text-xs text-gray-700">
      <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      Allow sending this meeting's transcript and chat context to the configured {chat.configuration.provider} endpoint for this question.
    </label>}
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-2">
      <textarea aria-label="Question about this meeting" rows={3} maxLength={4_000} value={draft} onChange={event => setDraft(event.target.value)} disabled={!chat.configuration || chat.pending} className="w-full resize-y rounded-md border p-2 text-sm" placeholder="What did we agree to do next?" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs" onClick={() => { submissionEpoch.current++; chat.reset(); setConfirmed(false); setDraft(''); }}><RotateCcw size={14} />Reset chat</button>
          <button type="button" className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs" onClick={() => { onOpenChange(false); router.push('/settings?tab=summary'); }}><Settings size={14} />Model settings</button>
          {meetingId && <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => { onOpenChange(false); router.push(`/meeting-details?id=${encodeURIComponent(meetingId)}`); }}>Open transcript</button>}
        </div>
        <button type="submit" disabled={!draft.trim() || !chat.configuration || chat.pending || (chat.configuration.requiresProviderConfirmation && !confirmed)} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40"><Send size={14} />Ask</button>
      </div>
    </form>
    <p className="text-xs text-gray-500">Check answers against the transcript. Chat history is cleared when you change meetings or close this dialog. Resetting or closing discards the reply; model generation may continue in the background.</p>
  </>;
}

export function MeetingChatAnswer({ content }: { content: string }) {
  return <div className="prose prose-sm max-w-none break-words"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    img: () => null,
    a: ({ children }) => <span>{children}</span>,
  }}>{content}</ReactMarkdown></div>;
}

export function MeetingChatDialog({ open, onOpenChange, currentMeetingId, meetings }: Props) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto">
      <DialogTitle>Ask this meeting</DialogTitle>
      <DialogDescription>Questions and answers use one selected meeting's transcript.</DialogDescription>
      {open && <MeetingChatConversation key={currentMeetingId ?? 'choose'} currentMeetingId={currentMeetingId} meetings={meetings} onOpenChange={onOpenChange} />}
    </DialogContent>
  </Dialog>;
}

export function MeetingChatButton({ meeting }: { meeting: Meeting }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm" title="Ask this meeting"><Bot size={16} />Ask meeting</button>
    <MeetingChatDialog open={open} onOpenChange={setOpen} currentMeetingId={meeting.id} meetings={[meeting]} />
  </>;
}
