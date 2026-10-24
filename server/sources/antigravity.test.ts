import { describe, it, expect } from 'vitest';
import { Office } from '../model/office';
import { NameStore } from '../model/names';
import { AccountsService } from '../accounts/service';
import { AntigravitySource, hubOrigin } from './antigravity';

const workspace = '/home/joo_vitor/projetos/qa-agents';
const session = { session: 'real-session-id', provider: 'antigravity', workspace: workspace + '/./', model: 'gemini-4-argon-medium', event: 'Stop', status: 'sem_sinal', last_seen: '2026-10-22T20:00:00-03:00' };
function setup() {
  const accounts = new AccountsService({ dirs: [], home: '/tmp', env: {}, onChange() {} });
  const office = new Office({ names: new NameStore(null), version: 'test', startedAt: 0, accounts: n => accounts.list(n), sources: () => source.sources(), accountName: id => accounts.find(id)?.detected.name });
  let body: any = { antigravity: { sessions: [session] } };
  const source = new AntigravitySource({ office, accounts, origin: 'http://127.0.0.1:4748', fetchStatus: async () => {
    if (body instanceof Error) throw body;
    return body;
  } });
  return { office, source, set: (next: any) => { body = next; } };
}
describe('real Hub sessions in the office', () => {
  it('adds Gemini to the Codex room and retains Stop/stale sessions without claiming fresh activity', async () => {
    const {office, source} = setup();
    office.addMain({id:'codex-existing',provider:'codex',account:'.codex',sessionId:'existing',cwd:workspace,role:'QA',startedAt:0,status:'idle'});
    await source.poll(); office.tick();
    const snap = office.commit().snapshot;
    const gemini = snap.agents.find(a => a.provider === 'antigravity');
    expect(gemini).toMatchObject({name:'Gemini',model:session.model,status:'idle',roomId:workspace,sessionId:session.session,telemetry:{status:'sem_sinal',event:'Stop',connected:true}});
    expect(snap.agents.find(a=>a.id==='codex-existing')?.roomId).toBe(gemini?.roomId);
    expect(snap.accounts.find(a=>a.id===gemini?.account)?.provider).toBe('antigravity');
    expect(source.sources()[0]).toMatchObject({sessions:1,ok:true,provider:'antigravity'});
    await source.poll(); office.tick();
    expect(office.list()).toHaveLength(2);
  });
  it('updates the same session and retains its last observation across network failure', async () => {
    const {office,source,set} = setup();
    await source.poll();
    set({antigravity:{sessions:[{...session,status:'trabalhando',event:'PreToolUse',last_seen:new Date().toISOString()}]}});
    await source.poll(); expect(office.list()[0].status).toBe('working');
    set(new Error('offline')); await source.poll(); office.tick();
    expect(office.list()).toHaveLength(1);
    expect(office.list()[0].telemetry?.connected).toBe(false);
    expect(source.sources()[0].ok).toBe(false);
  });
  it('does not invent sessions from malformed data or duplicate records', async () => {
    const {office,source,set} = setup();
    set({antigravity:{sessions:[{}, {...session,workspace:''}, session, session]}});
    await source.poll(); expect(office.list()).toHaveLength(1);
  });
  it('uses the host gateway in Docker and rejects external Hub origins', () => {
    expect(hubOrigin(true)).toBe('http://host.docker.internal:4748');
    expect(hubOrigin(false)).toBe('http://127.0.0.1:4748');
    expect(()=>hubOrigin(true,'https://external.example')).toThrow();
  });
});
describe('office representation versus Hub history', () => {
  it('keeps the workspace character identity when the latest conversation changes',async()=>{
    const {office,source,set}=setup();await source.poll();
    const before=office.list()[0].id;
    set({antigravity:{sessions:[session,{...session,session:'new-conversation',last_seen:new Date().toISOString()}]}});
    await source.poll();office.tick();
    expect(office.list()).toHaveLength(1);
    expect(office.list()[0]).toMatchObject({id:before,sessionId:'new-conversation'});
  });
  it('keeps only the latest idle Gemini per workspace while retaining all observed sessions', async () => {
    const {office,source,set}=setup();
    const old={...session,session:'old',last_seen:'2026-10-22T19:00:00-03:00'};
    const latest={...session,session:'latest',last_seen:'2026-10-22T21:00:00-03:00'};
    const busy={...session,session:'busy',status:'trabalhando',event:'PreToolUse',last_seen:new Date().toISOString()};
    set({antigravity:{sessions:[old,latest,busy]}});
    await source.poll();office.tick();
    const shown=office.commit().snapshot.agents.filter(a=>a.provider==='antigravity');
    expect(shown.map(a=>a.sessionId).sort()).toEqual(['busy','latest']);
    expect(source.status().antigravity.sessions).toHaveLength(3);
    expect(source.sources()[0].sessions).toBe(3);
  });

  it('does not represent a stale working observation as a live process', async () => {
    const {office,source,set}=setup();
    const recentStop={...session,session:'recent-stop',last_seen:new Date(Date.now()-10_000).toISOString()};
    const staleWorking={...session,session:'stale-working',status:'trabalhando',event:'PreToolUse',last_seen:new Date(Date.now()-300_000).toISOString()};
    set({antigravity:{sessions:[staleWorking,recentStop]}});
    await source.poll();office.tick();
    const shown=office.commit().snapshot.agents.filter(a=>a.provider==='antigravity');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({sessionId:'recent-stop',status:'idle'});
    expect(source.status().antigravity.sessions).toHaveLength(2);
  });
});
