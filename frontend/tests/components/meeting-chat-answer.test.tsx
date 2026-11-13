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
    await act(async () => view.root.findAllByType('button').find(button => button.props.title === 'Reset conversation')!.props.onClick());
    await act(async () => textarea().props.onChange({ target: { value: 'Draft after reset' } }));
    await act(async () => resolve({ answer: 'Stale B reply', meetingId: 'B', provider: 'builtin-ai', model: 'synthetic', contextTruncated: false }));
    expect(textarea().props.value).toBe('Draft after reset');
  } finally { await act(async () => view.unmount()); }
});


test('imported suggestions use the displayed provider and require confirmation on every question', async () => {
  const calls: any[] = [];
  const configuration = { provider: 'openai', model: 'saved-model', configurationId: 'v2', requiresProviderConfirmation: true };
  const transport: ChatTransport = {
    configuration: async () => configuration,
    ask: async request => {
      calls.push(request);
      return { answer: 'Synthetic answer', meetingId: request.meetingId, provider: 'openai', model: 'saved-model', contextTruncated: true };
    },
  };
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<AppRouterContext.Provider value={{ push() {} } as any}>
      <MeetingChatConversation currentMeetingId="A" meetings={[{ id: 'A', title: 'A' }]} onOpenChange={() => {}} transport={transport} />
    </AppRouterContext.Provider>);
  });
  const content = () => JSON.stringify(view.toJSON());
  const buttons = () => view.root.findAllByType('button');
  try {
    expect(content()).toContain('saved-model');
    expect(content()).not.toContain('Qwen 3.5 4B');
    expect(view.root.findAllByType('option').map(option => option.props.value)).toEqual(['', 'A']);
    const suggestion = () => buttons().find(button => button.findAllByType('span').some(span => span.children.includes('Summarize key decisions made')))!;
    expect(suggestion().props.disabled).toBe(true);
    expect(calls).toHaveLength(0);
    await act(async () => view.root.findByType('input').props.onChange({ target: { checked: true } }));
    expect(suggestion().props.disabled).toBe(false);
    await act(async () => suggestion().props.onClick());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ meetingId: 'A', configurationId: 'v2', allowProviderRequest: true, query: 'Summarize the key decisions made in this meeting' });
    expect(content()).toContain('Partial transcript context');
    expect(view.root.findByType('input').props.checked).toBe(false);
    await act(async () => view.root.findByType('textarea').props.onChange({ target: { value: 'Next question' } }));
    expect(buttons().find(button => button.props.type === 'submit')!.props.disabled).toBe(true);
  } finally { await act(async () => view.unmount()); }
});

test('imported copy control copies the actual answer and drops stale clipboard completion after reset', async () => {
  let finishCopy!: () => void;
  const copied: string[] = [];
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
    writeText: (text: string) => { copied.push(text); return new Promise<void>(resolve => { finishCopy = resolve; }); },
  } } });
  const transport: ChatTransport = {
    configuration: async () => ({ provider: 'builtin-ai', model: 'synthetic', configurationId: 'v1', requiresProviderConfirmation: false }),
    ask: async () => ({ answer: 'Checklist by Friday', meetingId: 'A', provider: 'builtin-ai', model: 'synthetic', contextTruncated: false }),
  };
  let view!: ReturnType<typeof create>;
  try {
    await act(async () => {
      view = create(<AppRouterContext.Provider value={{ push() {} } as any}>
        <MeetingChatConversation currentMeetingId="A" meetings={[{ id: 'A', title: 'A' }]} onOpenChange={() => {}} transport={transport} />
      </AppRouterContext.Provider>);
    });
    const button = (title: string) => view.root.findAllByType('button').find(item => item.props.title === title)!;
    const ask = async () => {
      await act(async () => view.root.findByType('textarea').props.onChange({ target: { value: 'When?' } }));
      await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    };
    await ask();
    act(() => { void button('Copy response').props.onClick(); });
    expect(copied).toEqual(['Checklist by Friday']);
    await act(async () => finishCopy());
    expect(button('Copy response').findAllByType('span').some(span => span.children.includes('Copied'))).toBe(true);
    act(() => { void button('Copy response').props.onClick(); });
    await act(async () => button('Reset conversation').props.onClick());
    await ask();
    await act(async () => finishCopy());
    expect(button('Copy response').findAllByType('span').some(span => span.children.includes('Copied'))).toBe(false);
  } finally {
    if (view) await act(async () => view.unmount());
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
