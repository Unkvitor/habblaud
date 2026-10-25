import { describe, expect, it } from 'vitest';
import type { QaDelivery, QaTask } from '../../../shared/types';
import { actorLabel, decisionProblem, deliveryStage, parseEvidence, recordProblem } from './qa-deliveries';

const delivery = (status: QaDelivery['status']): QaDelivery => ({ id: 'd', submittedBy: 'a', summary: 's', evidence: [], status, createdAt: 1, updatedAt: 1, history: [] });
const task = (extra: Partial<QaTask>): QaTask => ({ id: 't', description: 'x', assigneeId: 'a', status: 'assigned', createdAt: 1, updatedAt: 1, events: [], parentId: 'p', ...extra });

describe('fluxo de entregas de QA', () => {
  it('só subtarefas em andamento têm fluxo de entrega', () => {
    expect(deliveryStage(task({ parentId: undefined }))).toBe('none');
    expect(deliveryStage(task({ status: 'pending' }))).toBe('none');
    expect(deliveryStage(task({ status: 'completed' }))).toBe('none');
    expect(deliveryStage(task({}))).toBe('can_record');
  });

  it('segue a última entrega', () => {
    expect(deliveryStage(task({ deliveries: [delivery('draft')] }))).toBe('draft');
    expect(deliveryStage(task({ status: 'awaiting_approval', deliveries: [delivery('in_review')] }))).toBe('in_review');
    expect(deliveryStage(task({ deliveries: [delivery('returned')] }))).toBe('can_record');
    expect(deliveryStage(task({ deliveries: [delivery('approved')] }))).toBe('none');
  });

  it('valida formulários de registro e decisão adequadamente no cliente', () => {
    expect(parseEvidence(' rel/1.txt \n\n  http://ci.local  \n ')).toEqual(['rel/1.txt', 'http://ci.local']);
    expect(recordProblem('', ['ev1'])).toBeDefined();
    expect(recordProblem('x'.repeat(2001), ['ev1'])).toBeDefined();
    expect(recordProblem('ok', Array.from({ length: 21 }, (_, i) => `ev${i}`))).toBeDefined();
    expect(recordProblem('ok', ['y'.repeat(501)])).toBeDefined();
    expect(recordProblem('Resumo correto', ['relatorio.html'])).toBeUndefined();

    expect(decisionProblem('')).toBeDefined();
    expect(decisionProblem('   ')).toBeDefined();
    expect(decisionProblem('x'.repeat(2001))).toBeDefined();
    expect(decisionProblem('Aprovado nos testes manuais')).toBeUndefined();
  });

  it('rotula adequadamente a identidade da interface local sem falsificar revisor', () => {
    const nameMap = (id: string) => id === 'agent:1' ? 'Agente Henrique' : id;
    expect(actorLabel('human:local-ui', nameMap)).toContain('interface local');
    expect(actorLabel('agent:1', nameMap)).toBe('Agente Henrique');
  });
});

