import { afterAll, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeetingChatAnswer } from '../../src/components/MeetingChat';

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
import { MeetingChat } from '../../src/components/MeetingChat';
import type { ChatTransport } from '../../src/hooks/useMeetingChat';
import type { ChatResponse } from '../../src/lib/meeting-chat';

// Keep Radix trigger state real; replace only the DOM portal for renderer tests.
// Native acceptance exercises the actual portal, Escape/outside close and focus.
const originalPopover = { ...await import('../../src/components/ui/popover') };
mock.module('../../src/components/ui/popover', () => ({
  ...originalPopover, PopoverContent: ({ children, ...props }: any) => <section {...props}>{children}</section>,
}));
afterAll(() => mock.module('../../src/components/ui/popover', () => originalPopover));
async function openChat(view: ReturnType<typeof create>) {
  const trigger = view.root.findByProps({ 'aria-label': 'Ask anything about this meeting' });
  if (!trigger.props['aria-expanded']) await act(async () => trigger.props.onClick({ defaultPrevented: false }));
}


test('late A submit cannot erase the draft for B or a reset conversation', async () => {
  let resolve!: (reply: ChatResponse) => void;
  const configuration = { provider: 'builtin-ai', model: 'synthetic', configurationId: 'v1', requiresProviderConfirmation: false };
  const transport: ChatTransport = {
    history: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    clear: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    configuration: async () => configuration,
    ask: () => new Promise(done => { resolve = done; }),
  };
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<AppRouterContext.Provider value={{ push() {} } as any}>
      <MeetingChat meetingId="A" transport={transport} />
    </AppRouterContext.Provider>);
  });
  await openChat(view);
  try {
    const textarea = () => view.root.findByType('textarea');
    await act(async () => textarea().props.onChange({ target: { value: 'Question for A' } }));
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    await act(async () => view.update(<AppRouterContext.Provider value={{ push() {} } as any}>
      <MeetingChat meetingId="B" transport={transport} />
    </AppRouterContext.Provider>));
    await openChat(view);
    await act(async () => textarea().props.onChange({ target: { value: 'New draft for B' } }));
    await act(async () => resolve({ answer: 'Old A reply', meetingId: 'A', provider: 'builtin-ai', model: 'synthetic', contextTruncated: false, historyRevision: 1, createdAt: '2026-11-15T12:00:00Z' }));
    expect(textarea().props.value).toBe('New draft for B');
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    await act(async () => view.root.findAllByType('button').find(button => button.props.title === 'Clear saved chat')!.props.onClick());
    await act(async () => textarea().props.onChange({ target: { value: 'Draft after reset' } }));
    await act(async () => resolve({ answer: 'Stale B reply', meetingId: 'B', provider: 'builtin-ai', model: 'synthetic', contextTruncated: false, historyRevision: 1, createdAt: '2026-11-15T12:00:00Z' }));
    expect(textarea().props.value).toBe('Draft after reset');
  } finally { await act(async () => view.unmount()); }
});


test('inline suggestions prefill the composer and sending requires confirmation for every provider request', async () => {
  const calls: any[] = [];
  const configuration = { provider: 'openai', model: 'saved-model', configurationId: 'v2', requiresProviderConfirmation: true };
  const transport: ChatTransport = {
    history: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    clear: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    configuration: async () => configuration,
    ask: async request => {
      calls.push(request);
      return { answer: 'Synthetic answer', meetingId: request.meetingId, provider: 'openai', model: 'saved-model', contextTruncated: true, historyRevision: request.historyRevision + 1, createdAt: '2026-11-15T12:00:00Z' };
    },
  };
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<AppRouterContext.Provider value={{ push() {} } as any}>
      <MeetingChat meetingId="A" transport={transport} />
    </AppRouterContext.Provider>);
  });
  await openChat(view);
  const content = () => JSON.stringify(view.toJSON());
  const buttons = () => view.root.findAllByType('button');
  try {
    expect(content()).toContain('saved-model');
    expect(content()).not.toContain('Qwen 3.5 4B');
    expect(view.root.findAllByType('select')).toHaveLength(0);
    expect(view.root.findByProps({ 'aria-label': 'Suggested questions' }).findAllByType('button').map(b => b.children.join(''))).toEqual(['What was decided?', 'List action items']);
    expect(content()).not.toContain('Ask Your Meetings AI');
    const suggestion = () => buttons().find(button => button.children.includes('What was decided?'))!;
    expect(suggestion().props.disabled).toBe(false);
    await act(async () => suggestion().props.onClick());
    expect(view.root.findByType('textarea').props.value).toBe('What was decided in this meeting?');
    expect(calls).toHaveLength(0);
    expect(buttons().find(button => button.props.type === 'submit')!.props.disabled).toBe(true);
    await act(async () => view.root.findByType('input').props.onChange({ target: { checked: true } }));
    expect(suggestion().props.disabled).toBe(false);
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ meetingId: 'A', configurationId: 'v2', allowProviderRequest: true, query: 'What was decided in this meeting?' });
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
    history: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    clear: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    configuration: async () => ({ provider: 'builtin-ai', model: 'synthetic', configurationId: 'v1', requiresProviderConfirmation: false }),
    ask: async request => ({ answer: 'Checklist by Friday', meetingId: 'A', provider: 'builtin-ai', model: 'synthetic', contextTruncated: false, historyRevision: request.historyRevision + 1, createdAt: '2026-11-15T12:00:00Z' }),
  };
  let view!: ReturnType<typeof create>;
  try {
    await act(async () => {
      view = create(<AppRouterContext.Provider value={{ push() {} } as any}>
        <MeetingChat meetingId="A" transport={transport} />
      </AppRouterContext.Provider>);
    });
    await openChat(view);
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
    await act(async () => button('Clear saved chat').props.onClick());
    await ask();
    await act(async () => finishCopy());
    expect(button('Copy response').findAllByType('span').some(span => span.children.includes('Copied'))).toBe(false);
  } finally {
    if (view) await act(async () => view.unmount());
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('source disclosure renders native timestamps and quotations as plain text', async () => {
  const transport: ChatTransport = {
    history: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    clear: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    configuration: async () => ({ provider: 'builtin-ai', model: 'synthetic', configurationId: 'v1', requiresProviderConfirmation: false }),
    ask: async request => ({ answer: 'Noor approved it.', meetingId: 'A', provider: 'builtin-ai', model: 'synthetic', contextTruncated: true, historyRevision: request.historyRevision + 1, createdAt: '2026-11-15T12:00:00Z',
      sources: [{ segmentId: 'late', timestamp: '45:00', text: '<script>unsafe</script> Noor approved the budget.' }] }),
  };
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<AppRouterContext.Provider value={{ push() {} } as any}>
    <MeetingChat meetingId="A" transport={transport} />
  </AppRouterContext.Provider>); });
  await openChat(view);
  try {
    await act(async () => view.root.findByType('textarea').props.onChange({ target: { value: 'Who approved the budget?' } }));
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(view.root.findByType('summary').children.join('')).toContain('Transcript sources');
    expect(view.root.findByType('blockquote').children.join('')).toContain('<script>unsafe</script>');
    expect(view.root.findAllByType('script')).toHaveLength(0);
    expect(JSON.stringify(view.toJSON())).toContain('45:00');
  } finally { await act(async () => view.unmount()); }
});


test('stopping preserves a new draft after a delayed reply and renews provider confirmation', async () => {
  let resolve!: (response: ChatResponse) => void;
  const cancelled: string[] = [];
  const transport: ChatTransport = {
    history: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    clear: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    configuration: async () => ({ provider: 'openai', model: 'synthetic', configurationId: 'v1', requiresProviderConfirmation: true }),
    ask: () => new Promise(done => { resolve = done; }),
    cancel: async id => { cancelled.push(id); },
  };
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<AppRouterContext.Provider value={{ push() {} } as any}>
    <MeetingChat meetingId="A" transport={transport} />
  </AppRouterContext.Provider>); });
  await openChat(view);
  try {
    const textarea = () => view.root.findByType('textarea');
    await act(async () => textarea().props.onChange({ target: { value: 'Old question' } }));
    await act(async () => view.root.findByType('input').props.onChange({ target: { checked: true } }));
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    await act(async () => view.root.findAllByType('button').find(b => b.children.includes('Stop generating'))!.props.onClick());
    expect(cancelled).toHaveLength(1);
    expect(view.root.findByType('input').props.checked).toBe(false);
    await act(async () => textarea().props.onChange({ target: { value: 'New draft after Stop' } }));
    await act(async () => resolve({ answer: 'Cancelled reply', meetingId: 'A', provider: 'openai', model: 'synthetic', contextTruncated: false, historyRevision: 1, createdAt: '2026-11-15T12:00:00Z' }));
    expect(textarea().props.value).toBe('New draft after Stop');
    expect(JSON.stringify(view.toJSON())).not.toContain('Cancelled reply');
    expect(view.root.findAllByType('button').find(b => b.props.type === 'submit')!.props.disabled).toBe(true);
  } finally { await act(async () => view.unmount()); }
});

test('floating launcher preserves a draft, cancels on close and hides stale output on reopen', async () => {
  let resolve!: (reply: ChatResponse) => void;
  const cancelled: string[] = [];
  const transport: ChatTransport = {
    configuration: async () => ({ provider: 'builtin-ai', model: 'synthetic', configurationId: 'v1', requiresProviderConfirmation: false }),
    history: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    clear: async meetingId => ({ meetingId, revision: 1, messages: [] }),
    ask: () => new Promise(done => { resolve = done; }),
    cancel: async id => { cancelled.push(id); },
  };
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<AppRouterContext.Provider value={{ push() {} } as any}>
    <MeetingChat meetingId="A" transport={transport} />
  </AppRouterContext.Provider>); });
  try {
    expect(view.root.findAllByType('textarea')).toHaveLength(0);
    await openChat(view);
    const textarea = () => view.root.findByType('textarea');
    const close = () => view.root.findByProps({ 'aria-label': 'Close meeting chat' }).props.onClick();
    await act(async () => textarea().props.onChange({ target: { value: 'My unsent question' } }));
    await act(async () => close());
    expect(view.root.findAllByType('textarea')).toHaveLength(0);
    await openChat(view);
    expect(textarea().props.value).toBe('My unsent question');
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    await act(async () => close());
    expect(cancelled).toHaveLength(1);
    await act(async () => resolve({ answer: 'Cancelled answer', meetingId: 'A', provider: 'builtin-ai', model: 'synthetic', contextTruncated: false, historyRevision: 1, createdAt: '2026-11-16T12:00:00Z' }));
    await openChat(view);
    expect(textarea().props.value).toBe('My unsent question');
    expect(JSON.stringify(view.toJSON())).not.toContain('Cancelled answer');
  } finally { await act(async () => view.unmount()); }
});
