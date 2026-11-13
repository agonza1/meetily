import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeetingChatAnswer } from '../../src/components/MeetingChatDialog';

test('meeting answers cannot embed remote images, active links or raw HTML', () => {
  const html = renderToStaticMarkup(<MeetingChatAnswer content={'**Decision**\n\n![private](https://example.invalid/beacon?text=private)\n\n[Send](https://example.invalid/private)\n\n<script>alert(1)</script>'} />);
  expect(html).toContain('<strong>Decision</strong>');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('href=');
  expect(html).not.toContain('<script>');
});


// Exercise the real form state as well as the hook: an old submit continuation
// must not erase a question being composed for a different meeting.
import { act, create } from 'react-test-renderer';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { MeetingChatConversation } from '../../src/components/MeetingChatDialog';
import type { ChatTransport } from '../../src/hooks/useMeetingChat';
import type { ChatResponse } from '../../src/lib/meeting-chat';

test('late A submit cannot erase the draft for B or a reset conversation', async () => {
  let resolve!: (reply: ChatResponse) => void;
  const configuration = { provider: 'builtin-ai', model: 'synthetic', configurationId: 'v1', requiresProviderConfirmation: false };
  const transport: ChatTransport = {
    configuration: async () => configuration,
    ask: () => new Promise(done => { resolve = done; }),
  };
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<AppRouterContext.Provider value={{ push() {} } as any}>
      <MeetingChatConversation currentMeetingId="A" meetings={[{ id: 'A', title: 'A' }, { id: 'B', title: 'B' }]} onOpenChange={() => {}} transport={transport} />
    </AppRouterContext.Provider>);
  });
  try {
    const textarea = () => view.root.findByType('textarea');
    await act(async () => textarea().props.onChange({ target: { value: 'Question for A' } }));
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    await act(async () => view.root.findByType('select').props.onChange({ target: { value: 'B' } }));
    await act(async () => textarea().props.onChange({ target: { value: 'New draft for B' } }));
    await act(async () => resolve({ answer: 'Old A reply', meetingId: 'A', provider: 'builtin-ai', model: 'synthetic', contextTruncated: false }));
    expect(textarea().props.value).toBe('New draft for B');
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    await act(async () => view.root.findAllByType('button').find(button => button.children.some(child => child === 'Reset chat'))!.props.onClick());
    await act(async () => textarea().props.onChange({ target: { value: 'Draft after reset' } }));
    await act(async () => resolve({ answer: 'Stale B reply', meetingId: 'B', provider: 'builtin-ai', model: 'synthetic', contextTruncated: false }));
    expect(textarea().props.value).toBe('Draft after reset');
  } finally { await act(async () => view.unmount()); }
});
