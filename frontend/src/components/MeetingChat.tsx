"use client";

// Adapted from Muhammed Shareef M / shareefmx, Meetily PR #810 (MIT),
// pinned source b86d08999efbd6ee6e8257f764f9a837fc6de7de.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Copy, RotateCcw, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { useMeetingChat, type ChatTransport } from '../hooks/useMeetingChat';

export function MeetingChatAnswer({ content }: { content: string }) {
  return <div className="prose prose-sm max-w-none break-words">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{content}</ReactMarkdown>
  </div>;
}

const suggestions = [
  ['What was decided?', 'What was decided in this meeting?'],
  ['List action items', 'List the action items from this meeting. Include owners and deadlines only if stated.'],
];

export function MeetingChat({ meetingId, transport }: { meetingId: string; transport?: ChatTransport }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const chat = useMeetingChat(meetingId, true, transport);
  const [input, setInput] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const epoch = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = Boolean(chat.configuration && chat.revision !== null && !chat.pending && (!chat.configuration.requiresProviderConfirmation || confirmed));
  useEffect(() => {
    epoch.current++;
    setInput(''); setConfirmed(false); setCopiedId(null);
    return () => { epoch.current++; if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, [meetingId, chat.configuration?.configurationId]);
  useEffect(() => { setOpen(false); }, [meetingId]);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: 'nearest' }); }, [open, chat.messages.length, chat.pending]);
  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      epoch.current++; setConfirmed(false);
      if (chat.pending) void chat.stop();
    }
  }
  async function send() {
    const version = epoch.current;
    if (await chat.send(input, confirmed) && epoch.current === version) { setInput(''); setConfirmed(false); }
  }
  async function copy(text: string, id: string) {
    const version = epoch.current;
    try {
      await navigator.clipboard.writeText(text);
      if (version !== epoch.current) return;
      setCopiedId(id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 2000);
    } catch { if (version === epoch.current) toast.error('Could not copy the response'); }
  }
  return <div className="absolute bottom-5 right-5 z-30 w-[calc(100%-2.5rem)] max-w-md">
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Ask anything about this meeting" tabIndex={open ? -1 : 0} className={'w-full rounded-full border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm text-gray-500 shadow-md hover:bg-white ' + (open ? 'invisible' : '')}>Ask anything…</button>
      </PopoverTrigger>
      {open && <PopoverContent side="top" align="end" sideOffset={8} aria-label="Ask about this meeting" onOpenAutoFocus={event => { if (inputRef.current && !inputRef.current.disabled) { event.preventDefault(); inputRef.current.focus(); } }} className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-xl bg-white p-4 shadow-lg">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-gray-800">Ask about this meeting</h2>
      <div className="flex items-center gap-2">
      {chat.messages.length > 0 && <button type="button" title="Clear saved chat" aria-label="Clear saved chat" className="p-1 text-gray-500 hover:text-gray-900" onClick={() => {
        epoch.current++; void chat.reset(); setInput(''); setConfirmed(false); setCopiedId(null);
      }}><RotateCcw size={15} /></button>}
      <button type="button" aria-label="Close meeting chat" title={chat.pending ? 'Close and stop generation' : 'Close'} onClick={() => changeOpen(false)} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"><X size={16} /></button>
      </div>
    </div>
    {chat.messages.length > 0 && <div role="log" aria-label="Meeting conversation" aria-live="polite" className="min-h-0 max-h-[28vh] overflow-y-auto space-y-3 text-sm">
      {chat.messages.map((message, index) => {
        const id = message.id ?? `${message.role}-${index}`;
        return <div key={id} className={message.role === 'user' ? 'rounded-lg bg-blue-50 p-3' : 'rounded-lg bg-gray-50 p-3'}>
          <p className="mb-1 text-xs font-medium text-gray-500">{message.role === 'user' ? 'You' : 'Answer'}</p>
          <MeetingChatAnswer content={message.content} />
          {Boolean(message.sources?.length) && <details className="mt-2 text-xs text-gray-600">
            <summary className="cursor-pointer text-blue-700">Transcript sources ({message.sources!.length})</summary>
            <ul className="mt-2 space-y-2">{message.sources!.map((source, sourceIndex) => <li key={`${source.segmentId}-${sourceIndex}`}>
              <span>{source.timestamp}</span><blockquote className="border-l-2 border-blue-200 pl-2 whitespace-pre-wrap">{source.text}</blockquote>
            </li>)}</ul>
          </details>}
          {message.role === 'assistant' && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>{message.model}</span>
            {message.timestamp && <time>{Number.isFinite(Date.parse(message.timestamp)) ? new Date(message.timestamp).toLocaleString() : message.timestamp}</time>}
            {message.contextTruncated && <span className="text-amber-800">Partial transcript context</span>}
            <button type="button" title="Copy response" onClick={() => void copy(message.content, id)} className="ml-auto inline-flex items-center gap-1"><Copy size={13} /><span>{copiedId === id ? 'Copied' : 'Copy'}</span></button>
          </div>}
        </div>;
      })}
      <div ref={endRef} />
    </div>}
    {chat.pending && <p role="status" className="text-xs text-gray-500">Generating answer…</p>}
    <p className="text-sm text-gray-600">Generate a summary for instant decisions and action items.</p>
    <div className="flex flex-wrap gap-1.5" aria-label="Suggested questions">
      {suggestions.map(([label, query]) => <button key={label} type="button" disabled={chat.pending} className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-blue-50 disabled:opacity-50" onClick={() => { setInput(query); inputRef.current?.focus(); }}>{label}</button>)}
    </div>
    {chat.error && <p role="alert" className="text-sm text-red-700">{chat.error}</p>}
    {chat.configuration?.requiresProviderConfirmation && <label className="flex items-start gap-2 text-xs text-gray-600">
      <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      Allow sending this meeting's transcript and chat context to the configured {chat.configuration.provider} endpoint for this question.
    </label>}
    <form className="relative" onSubmit={event => { event.preventDefault(); void send(); }}>
      <textarea ref={inputRef} rows={3} maxLength={4000} aria-label="Question about this meeting" placeholder="Ask anything…" value={input} onChange={event => setInput(event.target.value)} disabled={chat.pending || !chat.configuration} className="w-full resize-none rounded-xl border border-gray-200 px-3 pb-11 pt-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
      {chat.pending ? <button type="button" className="absolute bottom-3 right-2 rounded-lg border bg-white px-3 py-1.5 text-sm" onClick={() => { epoch.current++; void chat.stop(); setConfirmed(false); }}>Stop generating</button>
        : <button type="submit" title="Send question" aria-label="Send question" disabled={!input.trim() || !canSend} className="absolute bottom-3 right-2 rounded-full bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:opacity-50"><ArrowUp size={18} /></button>}
    </form>
    <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
      <span title={chat.configuration ? chat.configuration.provider + ' · ' + chat.configuration.model : undefined}>This meeting · {chat.configuration ? chat.configuration.requiresProviderConfirmation ? chat.configuration.provider : 'On this Mac' : 'Choose a model'}</span>
      {(!chat.configuration || chat.error) && <button type="button" onClick={() => router.push('/settings?tab=summary')} className="text-blue-700">AI settings</button>}
    </div>
      </PopoverContent>}
    </Popover>
  </div>;
}
