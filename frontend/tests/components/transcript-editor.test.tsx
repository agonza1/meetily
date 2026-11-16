import { expect, test } from 'bun:test';
import { act, create } from 'react-test-renderer';
import { TranscriptEditor } from '../../src/components/MeetingDetails/TranscriptEditor';

const segment = { id: 'A-1', text: 'Maya ships Monday.', timestamp: 70 };
test('editing retains a failed draft, prevents blank saves and persists only on Save', async () => {
  const saved: string[] = [];
  let fail = true;
  let cancelled = 0;
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<TranscriptEditor segment={segment} onCancel={() => { cancelled++; }} onSave={async text => {
    if (fail) throw 'Transcript changed. Reload the meeting.';
    saved.push(text);
  }} />); });
  try {
    const textarea = () => view.root.findByType('textarea');
    const save = () => view.root.findByType('form').props.onSubmit({ preventDefault() {} });
    expect(textarea().props.value).toBe(segment.text);
    await act(async () => textarea().props.onChange({ target: { value: ' ' } }));
    await act(async () => save());
    expect(saved).toHaveLength(0);
    await act(async () => textarea().props.onChange({ target: { value: 'Maya ships Friday.' } }));
    await act(async () => save());
    expect(textarea().props.value).toBe('Maya ships Friday.');
    expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('Transcript changed');
    expect(cancelled).toBe(0);
    fail = false;
    await act(async () => save());
    expect(saved).toEqual(['Maya ships Friday.']);
    expect(cancelled).toBe(1);
  } finally { await act(async () => view.unmount()); }
});

test('Cancel discards a correction without saving, and a keyed meeting change starts with its own text', async () => {
  let saved = 0;
  let cancelled = 0;
  const props = { onSave: async () => { saved++; }, onCancel: () => { cancelled++; } };
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<TranscriptEditor key="A-1" segment={segment} {...props} />); });
  try {
    await act(async () => view.root.findByType('textarea').props.onChange({ target: { value: 'Unsaved A' } }));
    await act(async () => view.root.findAllByType('button').find(b => b.props.type === 'button')!.props.onClick());
    expect(saved).toBe(0);
    expect(cancelled).toBe(1);
    await act(async () => view.update(<TranscriptEditor key="B-1" segment={{ id: 'B-1', text: 'B original', timestamp: 15 }} {...props} />));
    expect(view.root.findByType('textarea').props.value).toBe('B original');
  } finally { await act(async () => view.unmount()); }
});
