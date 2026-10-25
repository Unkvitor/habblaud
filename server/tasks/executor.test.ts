import { describe, expect, it } from 'vitest';
import { ExecutionError, SupervisedExecutor } from './executor';
describe('SupervisedExecutor', () => {
  it('exige autorização vinculada ao plano, concorrência e não repete após crash', () => {
    const q=new SupervisedExecutor(1,()=>1); const a=q.enqueue({taskId:'t',executorId:'marcelo',threadId:'thread-a',idempotencyKey:'k',planHash:'p'});
    expect(q.enqueue({taskId:'t',executorId:'marcelo',threadId:'thread-a',idempotencyKey:'k',planHash:'p'}).id).toBe(a.id);
    expect(()=>q.authorize(a.id,'','p')).toThrow(ExecutionError); expect(q.authorize(a.id,'user-1','p').state).toBe('ready'); expect(q.start(a.id).state).toBe('running'); q.recover(); expect(q.list()[0].state).toBe('interrupted');
  });
});
