export type ChatConfiguration = {
  provider: string;
  model: string;
  configurationId: string;
  requiresProviderConfirmation: boolean;
};
export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  contextTruncated?: boolean;
};
export type ChatRequest = {
  meetingId: string;
  query: string;
  historyMeetingId: string;
  history: Pick<ChatMessage, 'role' | 'content'>[];
  configurationId: string;
  allowProviderRequest: boolean;
};
export type ChatResponse = {
  answer: string;
  meetingId: string;
  provider: string;
  model: string;
  contextTruncated: boolean;
};
export const chatByteLength = (text: string) => new TextEncoder().encode(text).length;

// Retain complete recent messages; never split UTF-8 or label another scope's history as current.
export function boundedChatHistory(messages: ChatMessage[]): ChatRequest['history'] {
  const history: ChatRequest['history'] = [];
  let bytes = 0;
  for (const { role, content } of messages.slice(-6).reverse()) {
    const size = chatByteLength(content);
    if (bytes + size > 6_000) break;
    history.unshift({ role, content });
    bytes += size;
  }
  return history;
}
