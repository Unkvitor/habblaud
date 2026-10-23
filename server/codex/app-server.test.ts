import { describe, it, expect } from 'vitest';
import { CodexProtocol } from './app-server';

const threadId = '11111111-1111-1111-1111-111111111111';
const request = (id: number | string, method = 'item/commandExecution/requestApproval', overrides = {}) => ({ id, method, params: { threadId, turnId: 'turn', itemId: 'item', ...overrides } });

describe('native App Server routing', () => {
  it('keeps split JSON lines and matches responses by typed request ID', async () => {
    const sent: any[] = [];
    const p = new CodexProtocol(j => sent.push(j));
    const result = p.call('thread/list', {});
    const id = sent[0].id;
    p.push('{"id":' + id + ',"result":');
    p.push('{"data":[]}}\n');
    expect(await result).toEqual({ data: [] });
  });
  it('routes only supported approvals of managed threads, with exact provenance, once', () => {
    const sent: any[] = [];
    const p = new CodexProtocol(j => sent.push(j));
    p.manage(threadId);
    p.push(JSON.stringify(request(99)) + '\n');
    const pending = p.approvals()[0];
    expect(pending).toMatchObject({ threadId, turnId: 'turn', itemId: 'item' });
    expect(() => p.decide({ ...pending, threadId: 'other' }, 'accept')).toThrow();
    expect(sent).toHaveLength(0);
    p.decide(pending, 'decline');
    expect(sent).toEqual([{ id: 99, result: { decision: 'decline' } }]);
    expect(() => p.decide(pending, 'accept')).toThrow();
  });
  it('does not expose control of existing threads or unsupported requests', () => {
    const p = new CodexProtocol(() => {});
    p.push(JSON.stringify(request(1)) + '\n');
    p.manage(threadId);
    p.push(JSON.stringify(request(2, 'item/tool/call')) + '\n');
    expect(p.approvals()).toEqual([]);
  });
  it('invalidates approvals resolved elsewhere or after connection loss', () => {
    const p = new CodexProtocol(() => {});
    p.manage(threadId);
    p.push(JSON.stringify(request('99')) + '\n');
    const old = p.approvals()[0];
    p.push(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId, requestId: '99' } }) + '\n');
    expect(() => p.decide(old, 'accept')).toThrow();
    p.push(JSON.stringify(request(100)) + '\n');
    p.close();
    expect(p.approvals()).toEqual([]);
  });
  it('does not accept an MCP URL or form without validating required content', () => {
    const sent: any[] = [];
    const p = new CodexProtocol(j => sent.push(j));
    p.manage(threadId);
    p.push(JSON.stringify(request(1, 'mcpServer/elicitation/request', { mode: 'url' })) + '\n');
    const approval = p.approvals()[0];
    expect(() => p.decide(approval, 'accept')).toThrow();
    p.decide(approval, 'decline');
    expect(sent[0]).toMatchObject({ id: 1, result: { action: 'decline', content: null } });
  });
});
it('deduplicates a repeated server request and invalidates it when its turn completes', () => {
  const sent: any[] = [];
  const p = new CodexProtocol(j => sent.push(j));
  p.manage(threadId);
  p.push(JSON.stringify(request(5)) + '\n');
  p.push(JSON.stringify(request(5)) + '\n');
  expect(p.approvals()).toHaveLength(1);
  const identity = p.approvals()[0];
  p.push(JSON.stringify({ method: 'turn/completed', params: { threadId, turn: { id: 'turn' } } }) + '\n');
  expect(() => p.decide(identity, 'accept')).toThrow();
  expect(sent).toHaveLength(0);
});