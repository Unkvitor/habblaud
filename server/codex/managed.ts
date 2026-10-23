import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { EventEmitter } from 'node:events';
import { CodexProtocol } from './app-server';
import { THREAD_ID } from '../messages/codex';
import { maskSecrets } from '../../shared/activity';
import { tr } from '../../shared/i18n';

type Json = Record<string, any>;
export function insideWorkspace(cwd: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(cwd));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !rel.startsWith(sep));
}
// Keep full answers. Never send hidden reasoning, arbitrary tool arguments or environment variables to the UI.
export function publicItem(item: Json): Json | null {
  let text: string;
  switch (item.type) {
    case 'agentMessage': text = item.text ?? ''; break;
    case 'userMessage': text = (item.content ?? []).filter((v: Json) => v.type === 'text').map((v: Json) => v.text).join('\n'); break;
    case 'plan': text = item.text ?? ''; break;
    case 'commandExecution': text = [item.command, item.aggregatedOutput].filter(Boolean).join('\n'); break;
    case 'fileChange': text = (item.changes ?? []).map((v: Json) => v.path).join('\n'); break;
    case 'mcpToolCall': text = `${item.server} / ${item.tool}`; break;
    default: return null;
  }
  return { id: item.id, type: item.type, text: maskSecrets(String(text)), status: item.status };
}
export class ManagedCodex extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private protocol?: CodexProtocol;
  private ready?: Promise<CodexProtocol>;
  private managed = new Set<string>();
  private loaded = new Set<string>();
  private busy = new Set<string>();
  private streaming = new Map<string, string>();
  private created = new Map<string, Json>();
  constructor(private bin: string, readonly workspace: string, private stateFile: string) {
    super();
    try { for (const id of JSON.parse(readFileSync(stateFile, 'utf8'))) if (THREAD_ID.test(id)) this.managed.add(id); } catch { /* new isolated state */ }
  }
  isManaged(id: string): boolean { return this.managed.has(id); }
  private connect(): Promise<CodexProtocol> {
    if (this.ready) return this.ready;
    const child = spawn(this.bin, ['app-server', '--stdio'], { stdio: 'pipe', windowsHide: true });
    this.child = child;
    const p = new CodexProtocol(j => {
      if (!child.stdin.writable) throw new Error(tr('App Server desconectado.'));
      child.stdin.write(JSON.stringify(j) + '\n');
    }, j => this.onEvent(j));
    this.protocol = p;
    for (const id of this.managed) p.manage(id);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { try { p.push(chunk); } catch { child.stdin.end(); } });
    child.stderr.resume(); // do not publish raw process logs or credentials
    const closed = () => {
      p.close(); this.loaded.clear(); this.streaming.clear(); this.created.clear();
      if (this.child === child) { this.ready = undefined; this.child = undefined; this.protocol = undefined; }
      this.emit('update', { method: 'connection/closed' });
    };
    child.on('error', closed); child.on('exit', closed);
    this.ready = p.call('initialize', { clientInfo: { name: 'habblaud_preview', version: '0.1.0' }, capabilities: null }).then(() => {
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n'); return p;
    }).catch(e => { child.stdin.end(); this.ready = undefined; throw e; });
    return this.ready;
  }
  private onEvent(j: Json): void {
    const v = j.params ?? {};
    if (!this.managed.has(v.threadId)) return;
    const event: Json = { method: j.method, threadId: v.threadId, turnId: v.turnId, itemId: v.itemId };
    const key = `${v.threadId}:${v.itemId ?? v.item?.id}`;
    if (j.method === 'item/agentMessage/delta') {
      const text = (this.streaming.get(key) ?? '') + String(v.delta ?? '');
      this.streaming.set(key, text); event.text = maskSecrets(text);
    }
    if (j.method === 'item/completed') this.streaming.delete(key);
    if (j.method === 'item/started' || j.method === 'item/completed') event.item = publicItem(v.item ?? {});
    if (j.method === 'thread/status/changed') event.status = v.status;
    this.emit('update', event);
  }
  async list(cursor?: string): Promise<Json> {
    const p = await this.connect();
    const page = await p.call('thread/list', { limit: 100, cursor, useStateDbOnly: true });
    if (!cursor) for (const thread of this.created.values()) if (!page.data.some((t: Json) => t.id === thread.id)) page.data.unshift(thread);
    return { data: page.data.filter((t: Json) => insideWorkspace(t.cwd, this.workspace)).map((t: Json) => ({
      id: t.id, name: maskSecrets(t.name || t.agentNickname || t.preview || t.id), status: t.status, managed: this.isManaged(t.id),
    })), nextCursor: page.nextCursor };
  }
  private async check(id: string): Promise<{ p: CodexProtocol; thread: Json }> {
    if (!THREAD_ID.test(id)) throw new Error(tr('Id de sessão inválido.'));
    const p = await this.connect();
    const { thread } = await p.call('thread/read', { threadId: id, includeTurns: false });
    if (!insideWorkspace(thread.cwd, this.workspace)) throw new Error(tr('Sessão fora do workspace permitido.'));
    return { p, thread };
  }
  async history(id: string, cursor?: string): Promise<Json> {
    const { p, thread } = await this.check(id);
    if (this.isManaged(id) && !thread.path) return { data: [], nextCursor: null };
    const page = await p.call('thread/items/list', { threadId: id, limit: 100, cursor, sortDirection: 'desc' });
    return { data: page.data.map((v: Json) => publicItem(v.item)).filter(Boolean), nextCursor: page.nextCursor };
  }
  async create(): Promise<Json> {
    // Merely loading the UI never starts or resumes a session. This is an explicit user action.
    const p = await this.connect();
    const cwd = realpathSync(this.workspace);
    const { thread } = await p.call('thread/start', { cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only',
      config: { 'features.multi_agent': false, 'mcp_servers.codex_tui.enabled': false } });
    this.managed.add(thread.id); this.loaded.add(thread.id); this.created.set(thread.id, thread); p.manage(thread.id);
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile + '.tmp', JSON.stringify([...this.managed]), { mode: 0o600 });
    renameSync(this.stateFile + '.tmp', this.stateFile);
    return { id: thread.id };
  }
  async send(id: string, text: string): Promise<void> {
    if (!this.managed.has(id) || this.busy.has(id)) throw new Error(tr('Sessão não gerenciada ou envio em andamento.'));
    if (typeof text !== 'string' || !text.trim() || text.length > 32_000) throw new Error(tr('Mensagem vazia ou longa demais.'));
    this.busy.add(id);
    try {
      const { p, thread } = await this.check(id);
      if (!this.loaded.has(id)) {
        if (thread.status?.type !== 'notLoaded') throw new Error(tr('Sessão aberta em outro cliente; mantenha o controle no cliente de origem.'));
        await p.call('thread/resume', { threadId: id, excludeTurns: true, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only',
          config: { 'features.multi_agent': false, 'mcp_servers.codex_tui.enabled': false } });
        this.loaded.add(id);
      }
      if (thread.status?.type === 'active') throw new Error(tr('Aguarde o turno atual concluir.'));
      await p.call('turn/start', { threadId: id, input: [{ type: 'text', text, text_elements: [] }] });
    } finally { this.busy.delete(id); }
  }
  approvals(): Json[] { return this.protocol?.approvals() ?? []; }
  decide(identity: any, decision: any): void {
    if (!this.protocol) throw new Error(tr('App Server desconectado.'));
    this.protocol.decide(identity, decision);
    this.emit('update', { method: 'approval/changed', threadId: identity.threadId });
  }
  // Close only our transport, never the shared daemon or a pre-existing session.
  disconnect(): void { this.child?.stdin.end(); }
}