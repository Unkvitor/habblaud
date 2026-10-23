// Native JSON-RPC over stdio. Never retries mutations or grants session-wide permission.
import { randomUUID } from 'node:crypto';
import { maskSecrets } from '../../shared/activity';
import { tr } from '../../shared/i18n';

type Json = Record<string, any>;
export interface NativeApproval {
  token: string; threadId: string; turnId: string | null; itemId: string | null;
  method: string; detail: Json;
}
const APPROVALS = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'mcpServer/elicitation/request']);
export class CodexProtocol {
  private buffer = '';
  private seq = 0;
  private managed = new Set<string>();
  private requests = new Map<string, { id: string | number; info: NativeApproval }>();
  private calls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private send: (j: Json) => void, private event: (j: Json) => void = () => {}) {}
  manage(threadId: string): void { this.managed.add(threadId); }
  call(method: string, params: Json): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(tr('App Server: tempo esgotado; confira o histórico antes de repetir.')));
      }, 20_000);
      this.calls.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (e) { clearTimeout(timer); this.calls.delete(id); reject(e); }
    });
  }
  push(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 32 * 1024 * 1024) { this.close(); throw new Error('App Server: frame too large'); }
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      const j: Json = JSON.parse(line);
      if (!j.method && typeof j.id === 'number') {
        const call = this.calls.get(j.id);
        if (call) {
          clearTimeout(call.timer); this.calls.delete(j.id);
          if (j.error) call.reject(new Error(maskSecrets(String(j.error.message)))); else call.resolve(j.result);
        }
        continue;
      }
      if (j.method === 'serverRequest/resolved') {
        for (const [key, value] of this.requests) {
          if (value.id === j.params?.requestId && value.info.threadId === j.params?.threadId) this.requests.delete(key);
        }
      }
      if (j.method === 'turn/completed' || j.method === 'thread/closed') {
        for (const [key, value] of this.requests) {
          if (value.info.threadId === j.params?.threadId && (j.method === 'thread/closed' || value.info.turnId === j.params?.turn?.id)) this.requests.delete(key);
        }
      }
      if ((typeof j.id === 'number' || typeof j.id === 'string') && APPROVALS.has(j.method) && this.managed.has(j.params?.threadId)) {
        if ([...this.requests.values()].some(v => v.id === j.id && v.info.threadId === j.params.threadId)) continue;
        const token = randomUUID();
        const info: NativeApproval = { token, threadId: j.params.threadId, turnId: j.params.turnId ?? null,
          itemId: j.params.itemId ?? null, method: j.method, detail: JSON.parse(maskSecrets(JSON.stringify(j.params))) };
        this.requests.set(token, { id: j.id, info });
      }
      this.event(j);
    }
  }
  approvals(): NativeApproval[] { return [...this.requests.values()].map(v => v.info); }
  decide(identity: NativeApproval, decision: 'accept' | 'decline'): void {
    const pending = this.requests.get(identity?.token);
    if (!pending || !['threadId', 'turnId', 'itemId', 'method'].every(k => (pending.info as any)[k] === (identity as any)[k])) throw new Error(tr('Solicitação expirada ou de outra sessão.'));
    if (decision !== 'accept' && decision !== 'decline') throw new Error(tr('Decisão inválida.'));
    const { info, id } = pending;
    if (decision === 'accept' && info.detail.grantRoot) throw new Error(tr('Concessões permanentes precisam ser avaliadas no cliente de origem.'));
    // Form/URL elicitation is not a generic tool approval. Decline is safe; accepting needs a schema-aware UI.
    if (info.method === 'mcpServer/elicitation/request' && decision === 'accept') throw new Error(tr('Este formulário MCP precisa ser respondido no cliente de origem.'));
    this.requests.delete(identity.token); // never replay even if the transport fails after writing
    this.send({ id, result: info.method === 'mcpServer/elicitation/request' ? { action: decision, content: null, _meta: null } : { decision } });
  }
  close(): void {
    this.buffer = ''; this.requests.clear();
    for (const call of this.calls.values()) { clearTimeout(call.timer); call.reject(new Error(tr('App Server desconectado; confira o histórico antes de repetir.'))); }
    this.calls.clear();
  }
}