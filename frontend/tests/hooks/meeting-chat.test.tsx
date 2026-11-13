import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useMeetingChat, type ChatTransport } from '../../src/hooks/useMeetingChat';
import { boundedChatHistory, chatByteLength, type ChatConfiguration, type ChatRequest, type ChatResponse } from '../../src/lib/meeting-chat';

type Pending = { request: ChatRequest; resolve: (value: ChatResponse) => void; reject: (error: unknown) => void };
const local: ChatConfiguration = { provider: 'builtin-ai', model: 'qwen3.5:4b', configurationId: 'version-1', requiresProviderConfirmation: false };
let configuration = local;
let configurationReads = 0;
let transport: ChatTransport;
let pending: Pending[];
let state: ReturnType<typeof useMeetingChat>;
let renderer: ReactTestRenderer | undefined;
function View({ id, open }: { id: string | null; open: boolean }) {
  state = useMeetingChat(id, open, transport);
  return <output>{state.messages.map(message => message.content).join('|')}</output>;
}
beforeEach(() => {
  configuration = local;
  configurationReads = 0;
  pending = [];
  transport = {
    configuration: async () => { configurationReads++; return configuration; },
    ask: request => new Promise((resolve, reject) => pending.push({ request, resolve, reject })),
  };
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });
async function show(id: string | null, open = true) {
  await act(async () => {
    if (renderer) renderer.update(<View id={id} open={open} />);
    else renderer = create(<View id={id} open={open} />);
  });
}
async function send(question = 'What was decided?', allow = false) {
  await act(async () => { void state.send(question, allow); });
}
async function answer(index: number, text = 'A supported answer', override: Partial<ChatResponse> = {}) {
  const request = pending[index].request;
  await act(async () => pending[index].resolve({
    answer: text, meetingId: request.meetingId, provider: configuration.provider, model: configuration.model,
    contextTruncated: false, ...override,
  }));
}

describe('selected-meeting chat ownership', () => {
  test('requires a meeting before loading configuration or sending', async () => {
    await show(null);
    await send();
    expect(configurationReads).toBe(0);
    expect(pending.length).toBe(0);
  });
  test('binds the first request to the selected meeting and omits the current question from history', async () => {
    await show('A');
    await send('A question');
    expect(pending[0].request).toEqual({ meetingId: 'A', historyMeetingId: 'A', query: 'A question', history: [], configurationId: 'version-1', allowProviderRequest: false });
    await answer(0);
    expect(state.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(state.messages[1].model).toBe('builtin-ai · qwen3.5:4b');
  });
  test('reuses only previous messages from the current conversation', async () => {
    await show('A'); await send('First'); await answer(0, 'First answer'); await send('Follow up');
    expect(pending[1].request.history).toEqual([{ role: 'user', content: 'First' }, { role: 'assistant', content: 'First answer' }]);
  });
  test('switching A to B clears history and ignores late A output', async () => {
    await show('A'); await send('Private A question');
    await show('B'); await send('B question');
    await answer(0, 'A secret');
    expect(state.messages.map(message => message.content)).toEqual(['B question']);
    expect(state.pending).toBe(true);
    expect(pending[1].request.history).toEqual([]);
    await answer(1, 'B answer');
    expect(state.messages.map(message => message.content)).toEqual(['B question', 'B answer']);
  });
  test('returning A to B to A cannot revive the first A request', async () => {
    await show('A'); await send(); await show('B'); await show('A');
    await answer(0, 'Stale A answer');
    expect(state.messages).toEqual([]);
  });
  test('reset invalidates a reply and an old completion cannot unlock a newer request', async () => {
    await show('A'); await send('Old question');
    await act(async () => state.reset());
    await send('New question'); await answer(0, 'Discard me');
    expect(state.pending).toBe(true);
    await send('Duplicate click');
    expect(pending.length).toBe(2);
    await answer(1, 'Current answer');
    expect(state.messages.map(message => message.content)).toEqual(['New question', 'Current answer']);
  });
  test('closing and reopening clears history and discards the old reply', async () => {
    await show('A'); await send(); await show('A', false); await show('A'); await answer(0, 'Old answer');
    expect(state.messages).toEqual([]);
  });
  test('late configuration cannot be attached to a different meeting', async () => {
    const configs: ((value: ChatConfiguration) => void)[] = [];
    transport.configuration = () => new Promise(resolve => configs.push(resolve));
    await show('A'); await show('B');
    await act(async () => configs[0](local));
    expect(state.configuration).toBeNull();
    await act(async () => configs[1]({ ...local, configurationId: 'B-version' }));
    expect(state.configuration?.configurationId).toBe('B-version');
  });
  test('rejects an answer tagged for a different meeting or model', async () => {
    await show('A'); await send(); await answer(0, 'Foreign content', { meetingId: 'B' });
    expect(state.messages.some(message => message.content === 'Foreign content')).toBe(false);
    expect(state.error).toBeTruthy();
    await send(); await answer(1, 'Wrong model', { model: 'other-model' });
    expect(state.messages.some(message => message.content === 'Wrong model')).toBe(false);
  });
  test('requires explicit confirmation before using a configured provider endpoint', async () => {
    configuration = { ...local, provider: 'ollama', requiresProviderConfirmation: true };
    await show('A'); await send();
    expect(pending).toEqual([]);
    expect(state.error).toContain('Confirm');
    await send('Approved question', true);
    expect(pending[0].request.allowProviderRequest).toBe(true);
  });
  test('invalid questions are rejected by UTF-8 size before any native request', async () => {
    await show('A'); await send('🙂'.repeat(1_001));
    expect(pending).toEqual([]);
    expect(state.error).toBeTruthy();
  });
  test('surfaces native failure without persisting a failed assistant answer', async () => {
    await show('A'); await send();
    await act(async () => pending[0].reject('The selected local model is not ready.'));
    expect(state.pending).toBe(false);
    expect(state.error).toContain('not ready');
    expect(state.messages.every(message => message.role === 'user')).toBe(true);
  });
  test('unmount discards pending configuration and generation', async () => {
    await show('A'); await send();
    await act(async () => renderer!.unmount()); renderer = undefined;
    await answer(0, 'Late answer');
    await show('A');
    expect(state.messages).toEqual([]);
  });
});

describe('bounded chat history', () => {
  test('keeps recent complete messages within the native turn and byte limits', () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({ role: 'user' as const, content: `${index}${'患'.repeat(400)}` }));
    const history = boundedChatHistory(messages);
    expect(history.length).toBe(4);
    expect(history[0].content.startsWith('6')).toBe(true);
    expect(history.reduce((sum, message) => sum + chatByteLength(message.content), 0)).toBeLessThanOrEqual(6_000);
    expect(boundedChatHistory([{ role: 'assistant', content: 'x'.repeat(6_001) }])).toEqual([]);
  });
});
