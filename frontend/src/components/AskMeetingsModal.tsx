"use client";

// Imported presentation from Muhammed Shareef M / shareefmx, Meetily PR #810 (MIT).
// Pinned source: b86d08999efbd6ee6e8257f764f9a837fc6de7de, AskMeetingsModal.tsx.
// The native transport/history layer is hardened separately; cross-meeting scope is deferred.
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, X, RotateCcw, Send, Copy, Check, Layers, ArrowRight, CheckSquare, ListTodo, FileText } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { VisuallyHidden } from './ui/visually-hidden';
import { useMeetingChat, type ChatTransport } from '../hooks/useMeetingChat';

export interface MeetingItem { id: string; title: string }
interface Props {
  isOpen: boolean;
  onClose: () => void;
  meetings: MeetingItem[];
  currentMeetingId?: string | null;
  onOpenSettings?: () => void;
}
const providerName = (provider: string) => ({
  'builtin-ai': 'Built-in AI', ollama: 'Ollama', openai: 'OpenAI', claude: 'Claude',
  openrouter: 'OpenRouter', groq: 'Groq', 'custom-openai': 'Custom OpenAI',
}[provider] ?? provider);

export function SafeMessageRenderer({ content }: { content: string }) {
  return <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed break-words">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{content}</ReactMarkdown>
  </div>;
}

export function AskMeetingsConversation({ meetings: meetingList, currentMeetingId, onClose, onOpenSettings, transport }: Omit<Props, 'isOpen'> & { transport?: ChatTransport }) {
  const router = useRouter();
  const [selection, setSelection] = useState(currentMeetingId ?? '');
  const selectedScope = meetingList.some(meeting => meeting.id === selection) ? selection : '';
  const setSelectedScope = setSelection;
  const chat = useMeetingChat(selectedScope || null, true, transport);
  const [input, setInput] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const epoch = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loading = chat.pending;
  const modelConfig = chat.configuration ? { provider: providerName(chat.configuration.provider), model: chat.configuration.model } : null;
  const messages = chat.messages.map((message, index) => ({
    ...message, id: `${message.role}-${index}`, timestamp: message.timestamp ?? '', modelInfo: message.model,
  }));
  const canSend = Boolean(selectedScope && chat.configuration && !loading && (!chat.configuration.requiresProviderConfirmation || confirmed));
  useEffect(() => {
    epoch.current++;
    setInput(''); setConfirmed(false); setCopiedId(null);
    inputRef.current?.focus();
    return () => {
      epoch.current++;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [selectedScope, chat.configuration?.configurationId]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.messages.length, loading]);
  async function handleSend(queryText?: string) {
    const version = epoch.current;
    if (await chat.send(queryText ?? input, confirmed) && epoch.current === version) {
      setInput(''); setConfirmed(false);
    }
  }
  async function handleCopy(text: string, id: string) {
    const version = epoch.current;
    try {
      await navigator.clipboard.writeText(text);
      if (epoch.current !== version) return;
      setCopiedId(id);
      toast.success('Copied to clipboard');
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 2000);
    } catch { if (epoch.current === version) toast.error('Could not copy the response'); }
  }
  function handleReset() { epoch.current++; chat.reset(); setInput(''); setConfirmed(false); setCopiedId(null); }
  function handleSettingsClick() {
    onClose();
    if (onOpenSettings) onOpenSettings();
    else router.push('/settings?tab=summary');
  }
  const selectedMeeting = meetingList.find(meeting => meeting.id === selectedScope);
  return <>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm flex-shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Ask Your Meetings AI</h2>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleReset}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
              title="Reset conversation"
              aria-label="Reset conversation"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
              title="Close"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scope Selector Bar */}
        <div className="px-6 py-2.5 bg-gray-50/90 border-b border-gray-100 flex items-center gap-3 text-xs text-gray-600">
          <div className="flex items-center gap-1.5 font-medium text-gray-700 flex-shrink-0">
            <Layers className="w-3.5 h-3.5 text-gray-500" />
            <span>Meeting:</span>
          </div>

          <div className="relative flex-1 max-w-md">
            <select
              aria-label="Meeting to ask about"
              value={selectedScope}
              onChange={e => setSelectedScope(e.target.value)}
              className="w-full pl-3 pr-8 py-1.5 text-xs font-medium text-gray-800 bg-white border border-gray-200 rounded-lg shadow-sm hover:border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 appearance-none cursor-pointer truncate"
            >
              <option value="">Choose a meeting</option>
              {meetingList.map(meeting => (
                <option key={meeting.id} value={meeting.id}>
                  📌 {meeting.title}
                </option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-gray-400">
              <svg className="w-3 h-3 fill-current" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Chat Messages Container */}
        <div role="log" aria-label="Meeting conversation" aria-live="polite" aria-relevant="additions" className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0 max-h-[480px] bg-slate-50/30">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-8 text-center text-gray-500">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
                <Bot className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                {selectedMeeting ? `Ask anything about "${selectedMeeting.title}"` : 'Choose a meeting to start chatting'}
              </h3>
              <p className="text-xs text-gray-500 max-w-md mb-5">
                Ask about key decisions, action items, and topic discussions.
              </p>

              {/* Quick suggestions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg text-left">
                <button
                  disabled={!canSend}
                  onClick={() => void handleSend('What topics were discussed in this meeting?')}
                  className="p-2.5 text-xs bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 rounded-xl transition-all flex items-center gap-2 text-gray-700 shadow-sm"
                >
                  <Layers className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                  <span className="truncate">What topics were discussed?</span>
                </button>
                <button
                  disabled={!canSend}
                  onClick={() => void handleSend('Summarize the key decisions made in this meeting')}
                  className="p-2.5 text-xs bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 rounded-xl transition-all flex items-center gap-2 text-gray-700 shadow-sm"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span className="truncate">Summarize key decisions made</span>
                </button>
                <button
                  disabled={!canSend}
                  onClick={() => void handleSend('What are the action items and deliverables?')}
                  className="p-2.5 text-xs bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 rounded-xl transition-all flex items-center gap-2 text-gray-700 shadow-sm"
                >
                  <ListTodo className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                  <span className="truncate">What are the action items?</span>
                </button>
                <button
                  disabled={!canSend}
                  onClick={() => void handleSend('Give a quick high-level summary of the discussions')}
                  className="p-2.5 text-xs bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 rounded-xl transition-all flex items-center gap-2 text-gray-700 shadow-sm"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                  <span className="truncate">Give a high-level summary</span>
                </button>
              </div>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id}>
                {msg.role === 'user' ? (
                  /* User Bubble */
                  <div className="flex flex-col items-end">
                    <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-[85%] shadow-sm leading-relaxed">
                      {msg.content}
                    </div>
                    <span className="text-[10px] text-gray-400 mt-1 mr-1">{msg.timestamp}</span>
                  </div>
                ) : (
                  /* AI Assistant Bubble */
                  <div className="flex items-start gap-3 max-w-[95%]">
                    <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                      <Bot className="w-4 h-4" />
                    </div>

                    <div className="flex-1 bg-white border border-gray-100 shadow-sm rounded-2xl p-4 text-sm text-gray-800">
                      <SafeMessageRenderer content={msg.content} />

                      {/* Message Footer */}
                      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-100 text-[11px] text-gray-400">
                        <div className="flex items-center gap-2">
                          <span>{msg.timestamp}</span>
                          {msg.contextTruncated && <span className="text-amber-800">Partial transcript context</span>}
                          {msg.modelInfo && (
                            <span className="inline-flex items-center gap-1 bg-gray-100/90 text-gray-600 text-[10px] font-medium px-2 py-0.5 rounded-full border border-gray-200/60">
                              ⚡ {msg.modelInfo}
                            </span>
                          )}
                        </div>

                        <button
                          onClick={() => handleCopy(msg.content, msg.id)}
                          className="flex items-center gap-1 text-gray-500 hover:text-gray-800 px-2 py-1 hover:bg-gray-100 rounded transition-colors"
                          title="Copy response"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-600 text-xs">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span className="text-xs">Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {/* Loading Indicator */}
          {loading && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center flex-shrink-0 mt-1 shadow-sm animate-pulse">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm flex items-center gap-2 text-xs text-gray-500">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce"></span>
                </div>
                <span role="status">Analyzing meeting context and generating answer...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Bottom AI Status & Settings Bar */}
        <div className="px-6 py-2.5 bg-gray-50 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700">
              AI Model: {modelConfig ? `${modelConfig.provider} • ${modelConfig.model}` : 'Not configured'}
              {chat.configuration && <span className="ml-2 text-gray-500">{chat.configuration.requiresProviderConfirmation ? 'Configured provider endpoint' : 'On this Mac'}</span>}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              {loading ? 'Generating...' : modelConfig ? 'Configured' : chat.error ? 'Check settings' : selectedScope ? 'Loading settings' : 'Choose meeting'}
            </span>
          </div>

          <button
            onClick={handleSettingsClick}
            className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 transition-colors"
          >
            <span>Configure in Settings</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {chat.error && <p role="alert" className="mx-6 my-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{chat.error}</p>}
        {chat.configuration?.requiresProviderConfirmation && <label className="mx-6 my-2 flex items-start gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
          Allow sending this meeting's transcript and chat context to the configured {chat.configuration.provider} endpoint for this question.
        </label>}

        {/* Input Bar */}
        <div className="p-4 bg-white border-t border-gray-100">
          <form
            onSubmit={e => {
              e.preventDefault();
              void handleSend();
            }}
            className="flex items-center gap-2"
          >
            <textarea
              ref={inputRef}
              rows={2}
              maxLength={4000}
              aria-label="Question about this meeting"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={selectedScope ? 'Ask anything about this meeting...' : 'Choose a meeting first...'}
              disabled={loading || !modelConfig}
              className="flex-1 px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-gray-900 placeholder:text-gray-400 transition-all disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || !canSend}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium text-sm flex items-center gap-1.5 shadow-sm transition-all flex-shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>Ask AI</span>
            </button>
          </form>
        </div>
        {selectedScope && <button type="button" className="mx-6 mb-2 self-start text-xs text-blue-600 hover:text-blue-800" onClick={() => {
          onClose(); router.push(`/meeting-details?id=${encodeURIComponent(selectedScope)}`);
        }}>Open transcript</button>}
        <p className="px-6 pb-3 text-[11px] text-gray-500">Check answers against the transcript. Partial context is disclosed. Changing meetings or closing clears this chat; unfinished generation may continue in the background.</p>
  </>;
}

export function AskMeetingsModal({ isOpen, onClose, meetings, currentMeetingId, onOpenSettings }: Props) {
  return <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent aria-describedby={undefined} className="w-full max-w-2xl sm:max-w-3xl bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col h-[min(800px,92vh)] overflow-y-auto p-0 gap-0 [&>button.absolute]:hidden">
      <VisuallyHidden><DialogTitle>Ask Your Meetings AI</DialogTitle></VisuallyHidden>
      {isOpen && <AskMeetingsConversation key={currentMeetingId ?? 'choose'} currentMeetingId={currentMeetingId} meetings={meetings} onClose={onClose} onOpenSettings={onOpenSettings} />}
    </DialogContent>
  </Dialog>;
}
