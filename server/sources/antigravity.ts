// Read-only QA Hub telemetry -> real office agents. No CLI launch, inference or message delivery.
import { posix } from 'node:path';
import { hash32 } from '../../shared/hash';
import type { AgentSource } from './source';
import type { Office } from '../model/office';
import type { AccountsService } from '../accounts/service';
import type { AgentStatus, SourceInfo } from '../../shared/types';
import { maskSecrets } from '../../shared/activity';
import { tr } from '../../shared/i18n';

type Row = { session: string; workspace: string; model: string; status: string; event: string; last_seen: string };
const WORKING_FRESHNESS_MS = 60_000;
export function hubOrigin(inDocker: boolean, explicit?: string): string {
  const url = new URL(explicit || (inDocker ? 'http://host.docker.internal:4748' : 'http://127.0.0.1:4748'));
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]','host.docker.internal'].includes(url.hostname) || url.port !== '4748' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(tr('Endereço local do QA Hub inválido.'));
  return url.origin;
}
function normalize(raw: unknown): Row | null {
  const r = raw as Partial<Row> | null;
  if (!r || typeof r.session !== 'string' || !r.session.trim() || r.session.length > 128 || typeof r.workspace !== 'string' || !r.workspace.startsWith('/') || typeof r.last_seen !== 'string' || !Number.isFinite(Date.parse(r.last_seen))) return null;
  return { session: r.session, workspace: posix.normalize(r.workspace.trim()).replace(/\/$/, '') || '/', model: maskSecrets(typeof r.model === 'string' ? r.model.slice(0,128) : ''), status: typeof r.status === 'string' ? r.status : 'desconhecido', event: typeof r.event === 'string' ? r.event : 'outro', last_seen: r.last_seen };
}
function state(r: Row): AgentStatus {
  if (r.event === 'Stop') return 'idle';
  const age = Date.now() - Date.parse(r.last_seen);
  const fresh = age >= -WORKING_FRESHNESS_MS && age <= WORKING_FRESHNESS_MS;
  return r.status === 'trabalhando' && fresh ? 'working' : 'idle';
}
export class AntigravitySource implements AgentSource {
  readonly provider = 'antigravity' as const;
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private stopped = false;
  private online = false;
  private error?: string;
  private rows: Row[] = [];
  private ids = new Set<string>();
  private account = 'qa-hub-antigravity';
  private managed: Array<{cwd:string;nativeId?:string;status:string}> = [];
  setManagedSessions(sessions:Array<{cwd:string;nativeId?:string;status:string}>):void {
    this.managed=sessions;
    for(const id of this.ids){
      const agent=this.opts.office.get(id);
      if(!agent)continue;
      const active=sessions.some(s=>s.cwd===agent.roomId&&s.status==='working');
      const own=sessions.find(s=>s.nativeId===agent.sessionId);
      if(active)agent.status='working';
      else if(own)agent.status='idle';
    }
    this.opts.office.markDirty();
  }
  private executionState(row:Row):AgentStatus {
    if(this.managed.some(s=>s.cwd===row.workspace&&s.status==='working'))return 'working';
    if(this.managed.some(s=>s.nativeId===row.session))return 'idle';
    return state(row);
  }
  constructor(private opts: { office: Office; accounts: AccountsService; origin: string; fetchStatus?: () => Promise<unknown> }) {}
  async start(): Promise<void> {
    this.opts.office.beginBoot();
    try { await this.poll(); } finally { this.opts.office.endBoot(); }
    this.timer = setInterval(() => { void this.poll(); }, 4000);
  }
  stop(): void { this.stopped = true; if (this.timer) clearInterval(this.timer); }
  transcriptPathOf(): undefined { return undefined; }
  sources(): SourceInfo[] { return [{ provider: this.provider, label: 'QA Hub · Antigravity', path: this.opts.origin, sessions: this.rows.length, ok: this.online, ...(this.error ? {error:this.error} : {}) }]; }
  status(): { online: boolean; antigravity: { sessions: Row[] } } { return { online: this.online, antigravity: {sessions:this.rows} }; }
  async poll(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      const raw = await (this.opts.fetchStatus ? this.opts.fetchStatus() : fetch(this.opts.origin + '/api/status', { signal: AbortSignal.timeout(2500), redirect: 'error' }).then(async response => {
        if (!response.ok) throw new Error('Hub HTTP ' + response.status);
        return response.json();
      })) as { antigravity?: { sessions?: unknown[] } };
      if (this.stopped) return;
      if (!Array.isArray(raw?.antigravity?.sessions)) throw new Error(tr('Telemetria do QA Hub inválida.'));
      this.online = true; this.error = undefined;
      const unique = new Map<string,Row>();
      for (const rawRow of raw.antigravity.sessions) { const row = normalize(rawRow); if (row) unique.set(row.session,row); }
      this.rows = [...unique.values()];
      if (this.rows.length) {
        const [account] = this.opts.accounts.setProviderAccounts(this.provider, [{dir:this.opts.origin,detected:{id:this.account,configDir:this.opts.origin,short:'G',name:'Antigravity CLI · Gemini',color:'#5cc97b'}}]);
        this.account = account.id;
      }
      // The Hub returns observed conversation history, not a process list.
      // Show the latest idle observation per workspace and every working session.
      const latestIdle = new Map<string, Row>();
      const latest = new Map<string, Row>();
      for (const row of this.rows) {
        const current = latest.get(row.workspace);
        if (!current || Date.parse(row.last_seen) > Date.parse(current.last_seen)) latest.set(row.workspace,row);
        if (this.executionState(row) === 'working') continue;
        const previous = latestIdle.get(row.workspace);
        if (!previous || Date.parse(row.last_seen) > Date.parse(previous.last_seen)) latestIdle.set(row.workspace, row);
      }
      const present = new Set<string>();
      for (const row of this.rows.filter(row => (this.executionState(row) === 'working' && (latest.get(row.workspace)===row || state(row)==='working')) || latestIdle.get(row.workspace) === row)) {
        const id = 'antigravity:' + (latest.get(row.workspace)===row?'workspace':row.session) + ':' + hash32(row.workspace); present.add(id);
        const at = Date.parse(row.last_seen);
        this.opts.office.addMain({id,name:'Gemini',provider:this.provider,account:this.account,sessionId:row.session,cwd:row.workspace,role:tr('Antigravity CLI · telemetria do QA Hub'),startedAt:at,status:this.executionState(row)});
        const agent = this.opts.office.get(id)!;
        agent.sessionId = row.session;
        agent.name = 'Gemini'; agent.model = row.model; agent.lastEventAt = at;
        agent.telemetry = {status:row.status,event:row.event,lastSeen:row.last_seen,connected:true};
        agent.title = tr('Modelo: {0}. Último evento: {1} · {2} · {3}', [row.model || tr('não informado'),row.event,row.status,row.last_seen]);
      }
      // Stop/sem_sinal never remove a reported session. Removal requires a successful authoritative listing without it.
      for (const id of this.ids) if (!present.has(id)) this.opts.office.closeMain(id);
      this.ids = present;
      if (!this.rows.length) this.opts.accounts.setProviderAccounts(this.provider, []);
    } catch {
      this.online = false; this.error = tr('QA Hub indisponível; exibindo a última observação.');
      for (const id of this.ids) {
        const agent = this.opts.office.get(id);
        if (agent?.telemetry) agent.telemetry = {...agent.telemetry,connected:false};
      }
    } finally { this.polling = false; this.opts.office.markDirty(); }
  }
}
