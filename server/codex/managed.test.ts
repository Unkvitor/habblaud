import { expect, it } from 'vitest';
import { insideWorkspace, publicItem, ManagedCodex } from './managed';
it('confines native session access to the configured workspace', () => {
  expect(insideWorkspace('/work/qa', '/work/qa')).toBe(true);
  expect(insideWorkspace('/work/qa/tests', '/work/qa')).toBe(true);
  expect(insideWorkspace('/work/qa-other', '/work/qa')).toBe(false);
  expect(insideWorkspace('/work/qa/../secrets', '/work/qa')).toBe(false);
});
it('keeps the complete assistant message, masks secrets and omits hidden reasoning and tool arguments', () => {
  const text = 'resposta '.repeat(5000);
  expect(publicItem({ type: 'agentMessage', id: 'a', text })).toMatchObject({ text });
  expect(publicItem({ type: 'reasoning', id: 'r', content: ['private'] })).toBeNull();
  expect(publicItem({ type: 'mcpToolCall', id: 'm', server: 's', tool: 't', arguments: { password: 'secret' } })).not.toHaveProperty('arguments');
  expect(publicItem({ type: 'agentMessage', id: 's', text: 'sk-ant-abcdefghijklmnop' })?.text).toBe('sk-***');
});
it('publishes cumulative masked streaming text so history reconciliation cannot duplicate deltas', () => {
  const c = new ManagedCodex('not-executed', '/work/qa', '/nonexistent/native-state.json');
  (c as any).managed.add('t');
  const events: any[] = []; c.on('update', e => events.push(e));
  (c as any).onEvent({ method: 'item/agentMessage/delta', params: { threadId: 't', itemId: 'a', delta: 'hello ' } });
  (c as any).onEvent({ method: 'item/agentMessage/delta', params: { threadId: 't', itemId: 'a', delta: 'world' } });
  expect(events[1].text).toBe('hello world');
});
it('rejects control of a legacy session before launching any process', async () => {
  const c = new ManagedCodex('not-executed', '/work/qa', '/nonexistent/native-state.json');
  await expect(c.send('legacy', 'do not execute')).rejects.toThrow();
});