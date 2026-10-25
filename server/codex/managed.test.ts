import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
it('keeps a just-created empty thread selectable and does not request nonexistent rollout history', async () => {
  const id = '11111111-1111-1111-1111-111111111111';
  const c = new ManagedCodex('not-executed', '/work/qa', '/nonexistent/native-state.json');
  (c as any).managed.add(id);
  (c as any).created = new Map([[id, { id, cwd: '/work/qa', name: 'Codex', path: null, status: { type: 'idle' } }]]);
  (c as any).ready = Promise.resolve({ call: async (method: string) => {
    if (method === 'thread/list') return { data: [], nextCursor: null };
    if (method === 'thread/read') return { thread: { id, cwd: '/work/qa', path: null } };
    throw new Error('must not read nonexistent history');
  } });
  expect((await c.list()).data[0]).toMatchObject({ id, managed: true });
  expect((await c.history(id)).data).toEqual([]);
});
it('creates a session in the requested isolated real directory and rejects escapes before RPC', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habblaud-cwd-'));
  const cwd = join(root, 'isolated'); mkdirSync(cwd);
  const calls: any[] = [];
  const c = new ManagedCodex('not-executed', root, join(root,'state.json'));
  (c as any).ready = Promise.resolve({manage() {}, call: async (method: string, params: any) => {
    calls.push({method,params}); return {thread:{id:'11111111-1111-1111-1111-111111111111',cwd}};
  }});
  try {
    await c.create(cwd);
    expect(calls[0].params).toMatchObject({cwd,sandbox:'read-only',approvalPolicy:'on-request',approvalsReviewer:'user'});
    expect(calls[0].params.config).not.toHaveProperty('mcp_servers.codex_tui.enabled');
    await expect(c.create(join(root,'..'))).rejects.toThrow();
    symlinkSync(tmpdir(),join(root,'escape'));
    await expect(c.create(join(root,'escape'))).rejects.toThrow();
    expect(calls).toHaveLength(1);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
it('resolves a supervised turn only after the native completion event', async () => {
  const id = '11111111-1111-1111-1111-111111111111';
  const calls: string[] = [];
  const c = new ManagedCodex('not-executed', '/work/qa', '/nonexistent/native-state.json');
  (c as any).managed.add(id);
  (c as any).ready = Promise.resolve({ call: async (method: string) => {
    calls.push(method);
    if (method === 'thread/read') return { thread: { id, cwd: '/work/qa', status: { type: 'notLoaded' } } };
    if (method === 'thread/resume') return {};
    if (method === 'turn/start') {
      setTimeout(() => (c as any).onEvent({ method: 'turn/completed', params: { threadId: id, turnId: 'turn-1' } }), 0);
      return { turn: { id: 'turn-1' } };
    }
    throw new Error(`unexpected ${method}`);
  } });
  await expect(c.execute(id, 'tarefa pequena')).resolves.toMatchObject({ method: 'turn/completed', threadId: id });
  expect(calls).toEqual(['thread/read', 'thread/resume', 'turn/start']);
});
it('adopts an existing idle thread without creating a new session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'habblaud-adopt-')); const id = '11111111-1111-4111-8111-111111111111';
  const c = new ManagedCodex('not-executed', root, join(root, 'state.json'));
  const managed: string[] = [];
  (c as any).ready = Promise.resolve({ manage: (value: string) => managed.push(value), call: async (method: string) => method === 'thread/read' ? { thread: { id, cwd: root, status: { type: 'notLoaded' } } } : {} });
  try { await c.adopt(id); expect(c.isManaged(id)).toBe(true); expect(managed).toEqual([id]); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
