"use client";
import { useState } from 'react';
import { Bot } from 'lucide-react';
import { AskMeetingsModal, AskMeetingsConversation, type MeetingItem } from './AskMeetingsModal';
import type { ChatTransport } from '../hooks/useMeetingChat';
export { SafeMessageRenderer as MeetingChatAnswer } from './AskMeetingsModal';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; currentMeetingId: string | null; meetings: MeetingItem[] };
export function MeetingChatConversation({ onOpenChange, ...props }: Omit<Props, 'open'> & { transport?: ChatTransport }) {
  return <AskMeetingsConversation {...props} onClose={() => onOpenChange(false)} />;
}
export function MeetingChatDialog({ open, onOpenChange, currentMeetingId, meetings }: Props) {
  return <AskMeetingsModal isOpen={open} onClose={() => onOpenChange(false)} currentMeetingId={currentMeetingId} meetings={meetings} />;
}
export function MeetingChatButton({ meeting }: { meeting: MeetingItem }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm" title="Ask this meeting"><Bot size={16} />Ask meeting</button>
    <AskMeetingsModal isOpen={open} onClose={() => setOpen(false)} currentMeetingId={meeting.id} meetings={[meeting]} />
  </>;
}
