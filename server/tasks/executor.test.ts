import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../test/fixtures';
import { DeterministicSimulator, ExecutionError, SupervisedExecutor } from './executor';
import { RealCodexExecutor } from './real-executor';
describe('SupervisedExecutor', () => {
  it('exige autorização vinculada ao plano, concorrência e não repete após crash', () => {
    const q=new SupervisedExecutor({maxConcurrency:1,now:()=>1}); const a=q.enqueue({taskId:'t',executorId:'marcelo',threadId:'thread-a',idempotencyKey:'k',planHash:'p'});
    expect(q.enqueue({taskId:'t',executorId:'marcelo',threadId:'thread-a',idempotencyKey:'k',planHash:'p'}).id).toBe(a.id);
    expect(()=>q.authorize(a.id,'','p')).toThrow(ExecutionError); expect(q.authorize(a.id,'simulated:user-1','p').state).toBe('ready'); expect(q.start(a.id).state).toBe('running'); q.recover(); expect(q.list()[0].state).toBe('interrupted');
  });
  it('rejeita reutilizar a mesma chave de idempotência com plano ou thread diferentes, inclusive após restart', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'qa-executions.json');
      const q = new SupervisedExecutor({ file });
      const input = { taskId: 'qa-1', executorId: 'codex:marcelo', threadId: 'thread-1', idempotencyKey: 'once', planHash: 'hash-v1', mode: 'real' as const, scope: 'Leia AGENTS.md' };
      const first = q.enqueue(input);
      expect(q.enqueue(input).id).toBe(first.id);
      expect(() => q.enqueue({ ...input, planHash: 'hash-v2' })).toThrow(ExecutionError);
      expect(() => q.enqueue({ ...input, threadId: 'thread-2' })).toThrow(ExecutionError);
      expect(() => q.enqueue({ ...input, scope: 'Execute comandos' })).toThrow(ExecutionError);
      const restored = new SupervisedExecutor({ file });
      restored.load();
      expect(() => restored.enqueue({ ...input, executorId: 'codex:outro' })).toThrow(ExecutionError);
      expect(restored.enqueue(input).id).toBe(first.id);
    } finally { tmp.cleanup(); }
  });
  it('simula checkpoint, falha e cancelamento sem processo externo', () => {
    const q=new SupervisedExecutor(); const sim=new DeterministicSimulator(q);
    const a=q.enqueue({taskId:'a',executorId:'marcelo',threadId:'a',idempotencyKey:'a',planHash:'p'});q.authorize(a.id,'simulated:test','p');expect(sim.run(a.id).result).toBe('simulated:ok'); expect(q.list()[0].events.map(event => event.type)).toEqual(['created', 'authorized', 'started', 'checkpoint', 'completed']);
    const b=q.enqueue({taskId:'b',executorId:'henrique',threadId:'b',idempotencyKey:'b',planHash:'p'});q.authorize(b.id,'simulated:test','p');expect(sim.run(b.id,'timeout').state).toBe('failed');
  });
  it('preserva resultados e bloqueia escrita quando a fila persistida esta corrompida', () => {
    const tmp=tempDir();
    try {
      const file=join(tmp.dir,'qa-executions.json'); const first=new SupervisedExecutor({file,now:()=>7}); const execution=first.enqueue({taskId:'task',executorId:'agent',threadId:'thread',idempotencyKey:'key',planHash:'plan'});
      first.authorize(execution.id,'simulated:test','plan'); new DeterministicSimulator(first).run(execution.id);
      const restored=new SupervisedExecutor({file}); restored.load(); expect(restored.list()[0]).toMatchObject({id:execution.id,state:'completed',result:'simulated:ok'});
      writeFileSync(file,'{bad'); const corrupt=new SupervisedExecutor({file}); corrupt.load(); expect(()=>corrupt.enqueue({taskId:'task',executorId:'agent',threadId:'other',idempotencyKey:'other',planHash:'plan'})).toThrow(ExecutionError);
    } finally { tmp.cleanup(); }
  });
  it('encaminha somente plano real autorizado ao transporte Codex e registra progresso', async () => {
    const q=new SupervisedExecutor();
    const execution=q.enqueue({taskId:'task',executorId:'marcelo',threadId:'thread',idempotencyKey:'real-key',planHash:'real-plan',mode:'real',scope:'Leia apenas o arquivo README.md e informe o titulo.'} as any);
    expect(()=>q.authorize(execution.id,'simulated:test','real-plan')).toThrow(ExecutionError);
    q.authorizeHuman(execution.id,'human:local-ui','real-plan');
    const transport={adopt:async ()=>undefined,execute:async (_thread:string,_scope:string,onUpdate:(event:any)=>void)=>{onUpdate({method:'item/agentMessage/delta',text:'progresso'});return {method:'turn/completed',text:'resultado'};}};
    await new RealCodexExecutor(q,transport as any).run(execution.id);
    expect(q.list()[0]).toMatchObject({state:'completed',result:'resultado',checkpoint:'progresso',authorizationKind:'human'});
  });
});
