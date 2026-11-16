"use client";

// Adapted from Muhammed Shareef M / shareefmx, Meetily PR #810 (MIT),
// pinned source b86d08999efbd6ee6e8257f764f9a837fc6de7de.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Copy, RotateCcw } from 'lucide-react';
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
  ['Key decisions', 'Summarize the key decisions made in this meeting'],
  ['Action items', 'What are the action items, owners and deadlines?'],
  ['Topics', 'What topics were discussed in this meeting?'],
  ['Quick summary', 'Give a quick high-level summary of the discussions'],
];

export function MeetingChat({ meetingId, transport }: { meetingId: string; transport?: ChatTransport }) {
  const router = useRouter();
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
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [chat.messages.length, chat.pending]);
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
  return <section aria-label="Ask about this meeting" className="shrink-0 max-h-[60%] min-h-0 flex flex-col gap-2 border-t border-gray-200 bg-white p-3">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-gray-800">Ask about this meeting</h2>
      {chat.messages.length > 0 && <button type="button" title="Clear saved chat" aria-label="Clear saved chat" className="p-1 text-gray-500 hover:text-gray-900" onClick={() => {
        epoch.current++; void chat.reset(); setInput(''); setConfirmed(false); setCopiedId(null);
      }}><RotateCcw size={15} /></button>}
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
    <div className="flex flex-wrap gap-1.5" aria-label="Suggested questions">
      {suggestions.map(([label, query]) => <button key={label} type="button" disabled={chat.pending} className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-blue-50 disabled:opacity-50" onClick={() => { setInput(query); inputRef.current?.focus(); }}>{label}</button>)}
    </div>
    {chat.error && <p role="alert" className="text-sm text-red-700">{chat.error}</p>}
    {chat.configuration?.requiresProviderConfirmation && <label className="flex items-start gap-2 text-xs text-gray-600">
      <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      Allow sending this meeting's transcript and chat context to the configured {chat.configuration.provider} endpoint for this question.
    </label>}
    <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); void send(); }}>
      <textarea ref={inputRef} rows={2} maxLength={4000} aria-label="Question about this meeting" placeholder="Ask a question about this meeting…" value={input} onChange={event => setInput(event.target.value)} disabled={chat.pending || !chat.configuration} className="min-w-0 flex-1 resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
      {chat.pending ? <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => { epoch.current++; void chat.stop(); setConfirmed(false); }}>Stop generating</button>
        : <button type="submit" title="Send question" aria-label="Send question" disabled={!input.trim() || !canSend} className="rounded-lg bg-blue-600 p-2.5 text-white hover:bg-blue-700 disabled:opacity-50"><ArrowUp size={18} /></button>}
    </form>
    <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-gray-500">
      <span>{chat.configuration ? `${chat.configuration.provider === 'builtin-ai' ? 'Built-in AI' : chat.configuration.provider} · ${chat.configuration.model}${chat.configuration.requiresProviderConfirmation ? '' : ' · On this Mac'}` : 'Choose a model in Settings'}</span>
      <button type="button" onClick={() => router.push('/settings?tab=summary')} className="text-blue-700">AI settings</button>
    </div>
    <p className="text-[11px] text-gray-500">Check answers against their sources. Latest 20 answers saved locally. Clearing chat or editing the transcript removes this history.</p>
  </section>;
}
