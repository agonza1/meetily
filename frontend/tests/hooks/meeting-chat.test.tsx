import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useMeetingChat, type ChatTransport } from '../../src/hooks/useMeetingChat';
import { boundedChatHistory, chatByteLength, type ChatConfiguration, type ChatRequest, type ChatResponse, type ChatSource } from '../../src/lib/meeting-chat';

type Pending = { request: ChatRequest; preview: (matches: ChatSource[]) => void; resolve: (value: ChatResponse) => void; reject: (error: unknown) => void };
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
    history: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    clear: async meetingId => ({ meetingId, revision: 0, messages: [] }),
    configuration: async () => { configurationReads++; return configuration; },
    ask: (request, preview) => new Promise((resolve, reject) => pending.push({ request, preview, resolve, reject })),
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
    contextTruncated: false, historyRevision: request.historyRevision + 1, createdAt: '2026-11-15T12:00:00Z', ...override,
  }));
}

describe('selected-meeting chat ownership', () => {
  test('shows matches before the answer and ignores previews from stopped or previous requests', async () => {
    const match = { segmentId: 'segment-a', timestamp: '01:23', text: 'The checklist is due Friday.' };
    await show('A');
    await send('When is the checklist due?');
    await act(async () => pending[0].preview([match]));
    expect(state.pending).toBe(true);
    expect(state.matches).toEqual([match]);
    expect(state.messages.map(message => message.role)).toEqual(['user']);
    await act(async () => state.stop());
    await send('Another question');
    await act(async () => pending[0].preview([match]));
    expect(state.matches).toEqual([]);
    await act(async () => pending[1].preview([match]));
    await answer(1);
    expect(state.matches).toEqual([]);
    await show('B');
    await act(async () => pending[1].preview([match]));
    expect(state.matches).toEqual([]);
  });
  test('requires a meeting before loading configuration or sending', async () => {
    await show(null);
    await send();
    expect(configurationReads).toBe(0);
    expect(pending.length).toBe(0);
  });
  test('binds the first request to the selected meeting and omits the current question from history', async () => {
    await show('A');
    await send('A question');
    expect(pending[0].request).toMatchObject({ meetingId: 'A', historyMeetingId: 'A', query: 'A question', history: [], configurationId: 'version-1', allowProviderRequest: false });
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
  test('closing and reopening reloads saved history and discards the old pending reply', async () => {
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

test('stop cancels only the active request and discards its eventual answer', async () => {
  const cancelled: string[] = [];
  transport.cancel = async id => { cancelled.push(id); };
  await show('A'); await send();
  const id = pending[0].request.requestId;
  await act(async () => state.stop());
  expect(cancelled).toEqual([id]);
  expect(state.pending).toBe(false);
  await send('Next'); await answer(0, 'Cancelled output');
  expect(state.pending).toBe(true);
  await answer(1, 'Current answer', { sources: [{ segmentId: 's1', timestamp: '45:00', text: 'Exact evidence' }] });
  expect(state.messages.some(m => m.content === 'Cancelled output')).toBe(false);
  expect(state.messages.at(-1)?.sources?.[0].timestamp).toBe('45:00');
});

test('scope changes and closing cancel their pending native request', async () => {
  const cancelled: string[] = [];
  transport.cancel = async id => { cancelled.push(id); };
  await show('A'); await send();
  await show('B'); await send();
  await show('B', false);
  expect(cancelled).toEqual(pending.map(p => p.request.requestId));
});

test('restores completed messages with sources and uses the native history revision', async () => {
  transport.history = async meetingId => ({ meetingId, revision: 7, messages: [
    { id: 'saved-user', role: 'user', content: 'Prior question', timestamp: '2026-11-15T12:00:00Z' },
    { id: 'saved-answer', role: 'assistant', content: 'Saved answer', model: 'builtin-ai · earlier-model', sources: [{ segmentId: 's1', timestamp: '00:10', text: 'Original evidence' }] },
  ] });
  await show('A');
  expect(state.messages[1].sources?.[0].segmentId).toBe('s1');
  expect(state.messages[1].model).toContain('earlier-model');
  await show('A', false); await show('A');
  expect(state.messages.map(m => m.content)).toEqual(['Prior question', 'Saved answer']);
  await send('Follow-up');
  expect(pending[0].request.historyRevision).toBe(7);
  expect(pending[0].request.history.map(m => m.content)).toEqual(['Prior question', 'Saved answer']);
});

test('a late saved-history load cannot leak A messages into B', async () => {
  const loads: ((value: any) => void)[] = [];
  transport.history = () => new Promise(resolve => loads.push(resolve));
  await show('A'); await show('B');
  await act(async () => loads[0]({ meetingId: 'A', revision: 3, messages: [{ role: 'assistant', content: 'A history' }] }));
  expect(state.messages).toEqual([]);
  await act(async () => loads[1]({ meetingId: 'B', revision: 9, messages: [{ role: 'assistant', content: 'B history' }] }));
  expect(state.messages.map(m => m.content)).toEqual(['B history']);
});

test('clear waits for a durable new revision before allowing another question', async () => {
  let finish!: (history: any) => void;
  const scopes: string[] = [];
  transport.clear = meetingId => { scopes.push(meetingId); return new Promise(resolve => { finish = resolve; }); };
  await show('A'); await send('Old question');
  await act(async () => { void state.reset(); });
  await send('Cannot send during clear'); expect(pending).toHaveLength(1);
  await act(async () => finish({ meetingId: 'A', revision: 9, messages: [] }));
  await send('After clear'); expect(pending[1].request.historyRevision).toBe(9); expect(scopes).toEqual(['A']);
  await answer(0, 'Late old answer'); expect(state.pending).toBe(true);
  await answer(1, 'Current answer'); expect(state.messages.map(m => m.content)).toEqual(['After clear', 'Current answer']);
});

test('failed clear blocks sending and reopening restores the retained saved history', async () => {
  transport.history = async meetingId => ({ meetingId, revision: 2, messages: [{ role: 'assistant', content: 'Retained answer' }] });
  transport.clear = async () => { throw new Error('synthetic storage failure'); };
  await show('A'); await act(async () => state.reset());
  expect(state.error).toContain('Could not clear'); await send(); expect(pending).toHaveLength(0);
  await show('A', false); await show('A'); expect(state.messages[0].content).toBe('Retained answer');
});

test('a late A clear cannot erase the newly loaded B conversation', async () => {
  let finish!: (history: any) => void;
  transport.clear = () => new Promise(resolve => { finish = resolve; });
  transport.history = async meetingId => ({ meetingId, revision: 4, messages: [{ role: 'assistant', content: `${meetingId} saved` }] });
  await show('A'); await act(async () => { void state.reset(); }); await show('B');
  await act(async () => finish({ meetingId: 'A', revision: 5, messages: [] }));
  expect(state.messages[0].content).toBe('B saved'); expect(state.revision).toBe(4);
});

test('Stop reloads the durable revision if a reply completed just before cancellation', async () => {
  await show('A'); await send();
  transport.history = async meetingId => ({ meetingId, revision: 1, messages: [{ role: 'assistant', content: 'Completed before Stop' }] });
  await act(async () => state.stop()); await answer(0, 'Late UI completion');
  expect(state.messages.map(m => m.content)).toEqual(['Completed before Stop']);
  await send('Next question'); expect(pending[1].request.historyRevision).toBe(1);
});

test('wrong-scope saved history is rejected before enabling requests', async () => {
  transport.history = async () => ({ meetingId: 'foreign', revision: 0, messages: [{ role: 'assistant', content: 'Foreign saved content' }] });
  await show('A'); expect(state.messages).toEqual([]); expect(state.error).toBeTruthy();
  await send(); expect(pending).toHaveLength(0);
});


test('reports successful clear truthfully when model settings fail to reload', async () => {
  await show('A');
  transport.configuration = async () => { throw new Error('synthetic model configuration failure'); };
  transport.clear = async meetingId => ({ meetingId, revision: 8, messages: [] });
  await act(async () => state.reset());
  expect(state.messages).toEqual([]); expect(state.revision).toBe(8);
  expect(state.error).toContain('Saved chat cleared');
  await send(); expect(pending).toHaveLength(0);
});


test('saved conversations stay readable when current model settings are unavailable', async () => {
  transport.history = async meetingId => ({ meetingId, revision: 3, messages: [{ role: 'assistant', content: 'Saved answer remains readable' }] });
  transport.configuration = async () => { throw new Error('No configured model'); };
  await show('A'); expect(state.messages[0].content).toBe('Saved answer remains readable');
  expect(state.configuration).toBeNull(); expect(state.error).toContain('Choose a model');
  await send(); expect(pending).toHaveLength(0);
});
