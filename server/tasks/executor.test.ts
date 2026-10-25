import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../test/fixtures';
import { DeterministicSimulator, ExecutionError, SupervisedExecutor } from './executor';
describe('SupervisedExecutor', () => {
  it('exige autorização vinculada ao plano, concorrência e não repete após crash', () => {
    const q=new SupervisedExecutor({maxConcurrency:1,now:()=>1}); const a=q.enqueue({taskId:'t',executorId:'marcelo',threadId:'thread-a',idempotencyKey:'k',planHash:'p'});
    expect(q.enqueue({taskId:'t',executorId:'marcelo',threadId:'thread-a',idempotencyKey:'k',planHash:'p'}).id).toBe(a.id);
    expect(()=>q.authorize(a.id,'','p')).toThrow(ExecutionError); expect(q.authorize(a.id,'simulated:user-1','p').state).toBe('ready'); expect(q.start(a.id).state).toBe('running'); q.recover(); expect(q.list()[0].state).toBe('interrupted');
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
});
