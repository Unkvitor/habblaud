import { describe, expect, it } from 'vitest';
import { allowedQaTransitions } from './qa-tasks';
describe('tarefas QA', () => {
  it('expõe somente as transições manuais permitidas', () => {
    expect(allowedQaTransitions('pending')).toEqual(['assigned', 'blocked']);
    expect(allowedQaTransitions('completed')).toEqual([]);
  });
});
