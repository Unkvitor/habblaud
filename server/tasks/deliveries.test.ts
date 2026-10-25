import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { QaTaskError, QaTaskStore } from './store';

const MARCELO = 'codex:marcelo';
const HENRIQUE = 'codex:henrique';
const GEMINI = 'agy:gemini';
const reviewers = (...ids: string[]) => (id: string) => ids.includes(id);

function setup(file: string | null = null) {
  let now = 1_000;
  const store = new QaTaskStore(file, () => ++now);
  const parent = store.create({ description: 'Demanda principal', assigneeId: MARCELO });
  const sub = store.create({ description: 'Automatizar regressão', assigneeId: HENRIQUE, parentId: parent.id });
  store.transition(sub.id, 'assigned');
  return { store, parent, sub, now: () => now };
}
const code = (fn: () => unknown): string | undefined => { try { fn(); } catch (e) { return e instanceof QaTaskError ? e.code : 'other'; } return undefined; };

describe('entregas de QA (P2.6)', () => {
  it('registra entrega com resumo e evidências, vinculada ao responsável da subtarefa', () => {
    const { store, sub } = setup();
    const task = store.recordDelivery(sub.id, { summary: '  Suíte pronta  ', evidence: ['reports/run-1.html', 'reports/run-1.html', 'MR !42'] });
    expect(task.deliveries).toHaveLength(1);
    expect(task.deliveries![0]).toMatchObject({ submittedBy: HENRIQUE, summary: 'Suíte pronta', evidence: ['reports/run-1.html', 'MR !42'], status: 'draft' });
    expect(task.events.at(-1)).toMatchObject({ type: 'delivery_recorded', deliveryId: task.deliveries![0].id });
    // O autor não pode ser informado de fora.
    const spoof = store.get(sub.id)!.deliveries![0];
    expect(spoof.submittedBy).toBe(HENRIQUE);
  });

  it('rejeita registros inválidos sem alterar a tarefa', () => {
    const { store, parent, sub } = setup();
    const before = JSON.stringify(store.get(sub.id));
    for (const input of [{}, { summary: '' }, { summary: '   ' }, { summary: 'x'.repeat(2001) }, { summary: 'ok', evidence: 'texto' },
      { summary: 'ok', evidence: [''] }, { summary: 'ok', evidence: [1] }, { summary: 'ok', evidence: Array.from({ length: 21 }, (_, i) => `e${i}`) },
      { summary: 'ok', evidence: ['y'.repeat(501)] }]) {
      expect(code(() => store.recordDelivery(sub.id, input))).toBe('invalid');
    }
    expect(JSON.stringify(store.get(sub.id))).toBe(before);
    // Entregas só existem em subtarefas e em estados de trabalho.
    expect(code(() => store.recordDelivery(parent.id, { summary: 'ok' }))).toBe('invalid');
    expect(code(() => store.recordDelivery('inexistente', { summary: 'ok' }))).toBe('not-found');
    const pending = store.create({ description: 'Sub pendente', assigneeId: HENRIQUE, parentId: parent.id });
    expect(code(() => store.recordDelivery(pending.id, { summary: 'ok' }))).toBe('invalid-transition');
  });

  it('só aceita revisor com papel válido, diferente do responsável', () => {
    const { store, sub } = setup();
    const id = store.recordDelivery(sub.id, { summary: 'Pronto' }).deliveries![0].id;
    expect(code(() => store.requestDeliveryReview(sub.id, id, GEMINI, reviewers()))).toBe('forbidden');
    expect(code(() => store.requestDeliveryReview(sub.id, id, HENRIQUE, reviewers(HENRIQUE)))).toBe('forbidden');
    expect(code(() => store.requestDeliveryReview(sub.id, id, '', reviewers(GEMINI)))).toBe('invalid');
    expect(code(() => store.requestDeliveryReview(sub.id, 'nope', GEMINI, reviewers(GEMINI)))).toBe('not-found');
    expect(store.get(sub.id)!.deliveries![0]).toMatchObject({ status: 'draft' });
    expect(store.get(sub.id)!.deliveries![0].reviewerId).toBeUndefined();
    const sent = store.requestDeliveryReview(sub.id, id, GEMINI, reviewers(GEMINI));
    expect(sent.status).toBe('awaiting_approval');
    expect(sent.deliveries![0]).toMatchObject({ status: 'in_review', reviewerId: GEMINI });
    expect(code(() => store.requestDeliveryReview(sub.id, id, GEMINI, reviewers(GEMINI)))).toBe('invalid-transition');
  });

  it('exige dependências concluídas para enviar à revisão e concluir', () => {
    const { store, parent, sub } = setup();
    const dep = store.create({ description: 'Preparar ambiente', assigneeId: HENRIQUE });
    const blocked = store.create({ description: 'Rodar suíte', assigneeId: HENRIQUE, parentId: parent.id, dependencies: [dep.id] });
    store.transition(blocked.id, 'assigned');
    const id = store.recordDelivery(blocked.id, { summary: 'Rodada' }).deliveries![0].id;
    expect(code(() => store.requestDeliveryReview(blocked.id, id, GEMINI, reviewers(GEMINI)))).toBe('invalid-transition');
    expect(store.get(blocked.id)!.status).toBe('assigned');
    store.transition(dep.id, 'assigned'); store.transition(dep.id, 'completed');
    store.requestDeliveryReview(blocked.id, id, GEMINI, reviewers(GEMINI));
    store.decideDelivery(blocked.id, id, 'approved', { justification: 'ok', decidedBy: 'human:local-ui' }, reviewers(GEMINI));
    expect(store.transition(blocked.id, 'completed').status).toBe('completed');
    expect(store.get(sub.id)).toBeDefined();
  });

  it('bloqueia conclusão de dependência pendente mesmo sem entrega (tarefa comum)', () => {
    const { store } = setup();
    const dep = store.create({ description: 'Dep aberta', assigneeId: MARCELO });
    const task = store.create({ description: 'Depende', assigneeId: MARCELO, dependencies: [dep.id] });
    store.transition(task.id, 'assigned');
    expect(code(() => store.transition(task.id, 'completed'))).toBe('invalid-transition');
    store.transition(dep.id, 'assigned'); store.transition(dep.id, 'completed');
    expect(store.transition(task.id, 'completed').status).toBe('completed');
  });

  it('aprova a entrega com justificativa e só então conclui a subtarefa e a demanda principal', () => {
    const { store, parent, sub } = setup();
    // Sem entrega aprovada, nem a subtarefa nem a demanda principal concluem.
    expect(code(() => store.transition(sub.id, 'completed'))).toBe('invalid-transition');
    store.transition(parent.id, 'assigned');
    expect(code(() => store.transition(parent.id, 'completed'))).toBe('invalid-transition');
    const id = store.recordDelivery(sub.id, { summary: 'Pronto', evidence: ['log'] }).deliveries![0].id;
    expect(code(() => store.transition(sub.id, 'completed'))).toBe('invalid-transition');
    store.requestDeliveryReview(sub.id, id, GEMINI, reviewers(GEMINI));
    expect(code(() => store.transition(sub.id, 'completed'))).toBe('invalid-transition');
    expect(code(() => store.decideDelivery(sub.id, id, 'approved', { justification: '  ', decidedBy: 'human:local-ui' }, reviewers(GEMINI)))).toBe('invalid');
    expect(code(() => store.decideDelivery(sub.id, id, 'approved', { justification: 'ok' }, reviewers(GEMINI)))).toBe('invalid');
    expect(code(() => store.decideDelivery(sub.id, id, 'approved', { justification: 'ok', decidedBy: 'human:local-ui' }, reviewers()))).toBe('forbidden');
    const approved = store.decideDelivery(sub.id, id, 'approved', { justification: 'Evidências conferidas', decidedBy: 'human:local-ui' }, reviewers(GEMINI));
    expect(approved.deliveries![0]).toMatchObject({ status: 'approved', justification: 'Evidências conferidas', decidedBy: 'human:local-ui', reviewerId: GEMINI });
    expect(code(() => store.decideDelivery(sub.id, id, 'returned', { justification: 'tarde', decidedBy: 'human:local-ui' }, reviewers(GEMINI)))).toBe('invalid-transition');
    expect(store.transition(sub.id, 'completed').status).toBe('completed');
    expect(store.transition(parent.id, 'completed').status).toBe('completed');
  });

  it('devolve para ajustes, preserva o histórico e aceita nova entrega', () => {
    const { store, sub } = setup();
    const first = store.recordDelivery(sub.id, { summary: 'v1' }).deliveries![0].id;
    store.requestDeliveryReview(sub.id, first, GEMINI, reviewers(GEMINI));
    expect(code(() => store.recordDelivery(sub.id, { summary: 'v2 cedo' }))).toBe('invalid-transition');
    const returned = store.decideDelivery(sub.id, first, 'returned', { justification: 'Falta cobrir timeout', decidedBy: 'human:local-ui' }, reviewers(GEMINI));
    expect(returned.status).toBe('assigned');
    expect(returned.deliveries![0]).toMatchObject({ status: 'returned', justification: 'Falta cobrir timeout' });
    expect(code(() => store.transition(sub.id, 'completed'))).toBe('invalid-transition');

    const second = store.recordDelivery(sub.id, { summary: 'v2', evidence: ['run-2'] }).deliveries!.at(-1)!.id;
    store.requestDeliveryReview(sub.id, second, GEMINI, reviewers(GEMINI));
    const done = store.decideDelivery(sub.id, second, 'approved', { justification: 'Agora sim', decidedBy: 'human:local-ui' }, reviewers(GEMINI));
    expect(done.deliveries!.map((d) => [d.summary, d.status])).toEqual([['v1', 'returned'], ['v2', 'approved']]);
    expect(done.deliveries![0].history.map((e) => e.type)).toEqual(['delivery_recorded', 'delivery_review_requested', 'delivery_returned']);
    expect(done.events.map((e) => e.type).filter((t) => t.startsWith('delivery_'))).toEqual([
      'delivery_recorded', 'delivery_review_requested', 'delivery_returned', 'delivery_recorded', 'delivery_review_requested', 'delivery_approved']);
    expect(store.transition(sub.id, 'completed').status).toBe('completed');
  });

  it('uma entrega anterior aprovada não libera a conclusão se a mais recente não foi aprovada', () => {
    const { store, sub } = setup();
    const first = store.recordDelivery(sub.id, { summary: 'v1' }).deliveries![0].id;
    store.requestDeliveryReview(sub.id, first, GEMINI, reviewers(GEMINI));
    store.decideDelivery(sub.id, first, 'approved', { justification: 'ok', decidedBy: 'human:local-ui' }, reviewers(GEMINI));
    store.recordDelivery(sub.id, { summary: 'v2 após aprovação' });
    expect(code(() => store.transition(sub.id, 'completed'))).toBe('invalid-transition');
  });

  it('impede concluir a demanda principal com qualquer subtarefa aberta', () => {
    const { store, parent, sub } = setup();
    store.transition(parent.id, 'assigned');
    expect(code(() => store.transition(parent.id, 'completed'))).toBe('invalid-transition');
    expect(store.get(parent.id)!.status).toBe('assigned');
    expect(sub.status).toBe('pending');
  });

  it('persiste entregas e histórico após recarga, sem alterar o arquivo de quem não usa entregas', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'qa-tasks.json');
      const legacy = new QaTaskStore(file, () => 5);
      legacy.create({ description: 'Tarefa antiga', assigneeId: MARCELO });
      const legacyRaw = readFileSync(file, 'utf8');
      expect(JSON.parse(legacyRaw).tasks[0].deliveries).toBeUndefined();
      const reloaded = new QaTaskStore(file, () => 6); reloaded.load();
      expect(reloaded.list()).toHaveLength(1);
      expect(readFileSync(file, 'utf8')).toBe(legacyRaw);

      const { store, sub } = setup(file);
      const id = store.recordDelivery(sub.id, { summary: 'Persistir', evidence: ['a'] }).deliveries![0].id;
      store.requestDeliveryReview(sub.id, id, GEMINI, reviewers(GEMINI));
      const saved = store.decideDelivery(sub.id, id, 'returned', { justification: 'Ajustar', decidedBy: 'human:local-ui' }, reviewers(GEMINI));
      const restored = new QaTaskStore(file, () => 99); restored.load();
      expect(restored.get(sub.id)).toEqual(saved);
      expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);
      // Recarregar não executa nada nem muda estados.
      expect(restored.get(sub.id)!.status).toBe('assigned');
    } finally { tmp.cleanup(); }
  });

  it('rejeita arquivo com entregas inválidas e preserva os bytes originais', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'qa-tasks.json');
      const { store, sub } = setup(file);
      store.recordDelivery(sub.id, { summary: 'Base' });
      const good = JSON.parse(readFileSync(file, 'utf8'));
      const mutate = (fn: (tasks: any[]) => void) => { const copy = JSON.parse(JSON.stringify(good)); fn(copy.tasks); return JSON.stringify(copy); };
      const withDelivery = (tasks: any[]) => tasks.find((t) => t.deliveries);
      const cases = [
        mutate((t) => { withDelivery(t).deliveries[0].status = 'banana'; }),
        mutate((t) => { withDelivery(t).deliveries[0].summary = ''; }),
        mutate((t) => { withDelivery(t).deliveries[0].evidence = [1]; }),
        mutate((t) => { withDelivery(t).deliveries[0].history = []; }),
        mutate((t) => { withDelivery(t).deliveries[0].status = 'approved'; }),
        mutate((t) => { withDelivery(t).deliveries[0].status = 'in_review'; }),
        mutate((t) => { withDelivery(t).deliveries.push({ ...withDelivery(t).deliveries[0] }); }),
        mutate((t) => { delete withDelivery(t).parentId; }),
        mutate((t) => { withDelivery(t).deliveries = []; }),
        mutate((t) => { withDelivery(t).events.push({ id: 'x', at: 1, type: 'delivery_hacked', to: 'assigned' }); }),
      ];
      for (const content of cases) {
        writeFileSync(file, content);
        const bad = new QaTaskStore(file, () => 1); bad.load();
        expect(bad.list()).toEqual([]);
        expect(code(() => bad.create({ description: 'Nova', assigneeId: MARCELO }))).toBe('corrupt');
        expect(readFileSync(file, 'utf8')).toBe(content);
      }
    } finally { tmp.cleanup(); }
  });

  it('reencaminha a entrega quando o revisor vinculado deixou de ser elegível, sem destravar revisores presentes', () => {
    const { store, sub } = setup();
    const id = store.recordDelivery(sub.id, { summary: 'Pronto' }).deliveries![0].id;
    store.requestDeliveryReview(sub.id, id, GEMINI, reviewers(GEMINI));
    // Revisor ainda presente: nada de trocar de revisor por conta própria.
    expect(code(() => store.requestDeliveryReview(sub.id, id, MARCELO, reviewers(GEMINI, MARCELO)))).toBe('invalid-transition');
    expect(store.get(sub.id)!.deliveries![0].reviewerId).toBe(GEMINI);
    // Revisor sumiu: a decisão fica recusada e a entrega não pode ficar presa para sempre.
    expect(code(() => store.decideDelivery(sub.id, id, 'approved', { justification: 'ok', decidedBy: 'human:local-ui' }, reviewers(MARCELO)))).toBe('forbidden');
    expect(code(() => store.requestDeliveryReview(sub.id, id, HENRIQUE, reviewers(MARCELO, HENRIQUE)))).toBe('forbidden');
    expect(code(() => store.requestDeliveryReview(sub.id, id, GEMINI, reviewers(MARCELO)))).toBe('forbidden');
    const moved = store.requestDeliveryReview(sub.id, id, MARCELO, reviewers(MARCELO));
    expect(moved.status).toBe('awaiting_approval');
    expect(moved.deliveries![0]).toMatchObject({ status: 'in_review', reviewerId: MARCELO });
    expect(moved.deliveries![0].history.map((e) => [e.type, e.note])).toEqual([
      ['delivery_recorded', undefined], ['delivery_review_requested', GEMINI], ['delivery_review_requested', MARCELO]]);
    const approved = store.decideDelivery(sub.id, id, 'approved', { justification: 'ok', decidedBy: 'human:local-ui' }, reviewers(MARCELO));
    expect(approved.deliveries![0]).toMatchObject({ status: 'approved', reviewerId: MARCELO });
  });

  it('falha de gravação não deixa a memória adiante do disco nas operações de entrega', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'qa-tasks.json');
      const { store, sub } = setup(file);
      // Um diretório no lugar do arquivo faz o rename atômico falhar (EISDIR) depois da gravação do temporário.
      const sabotage = () => { rmSync(file); mkdirSync(join(file, 'x'), { recursive: true }); };
      const repair = () => rmSync(file, { recursive: true, force: true });
      const snapshot = () => JSON.stringify(store.get(sub.id));

      let before = snapshot(); sabotage();
      expect(code(() => store.recordDelivery(sub.id, { summary: 'Falha' }))).toBe('other');
      expect(snapshot()).toBe(before);
      repair();
      const id = store.recordDelivery(sub.id, { summary: 'Agora vai' }).deliveries![0].id;

      before = snapshot(); sabotage();
      expect(code(() => store.requestDeliveryReview(sub.id, id, GEMINI, reviewers(GEMINI)))).toBe('other');
      expect(snapshot()).toBe(before);
      expect(store.get(sub.id)!.status).toBe('assigned');
      repair();
      store.requestDeliveryReview(sub.id, id, GEMINI, reviewers(GEMINI));

      before = snapshot(); sabotage();
      expect(code(() => store.decideDelivery(sub.id, id, 'returned', { justification: 'Ajustar', decidedBy: 'human:local-ui' }, reviewers(GEMINI)))).toBe('other');
      expect(snapshot()).toBe(before);
      expect(store.get(sub.id)!.status).toBe('awaiting_approval');
      repair();
      expect(store.decideDelivery(sub.id, id, 'returned', { justification: 'Ajustar', decidedBy: 'human:local-ui' }, reviewers(GEMINI)).status).toBe('assigned');
      // O arquivo reflete exatamente a memória: recarregar devolve o mesmo estado.
      const reloaded = new QaTaskStore(file, () => 1); reloaded.load();
      expect(reloaded.get(sub.id)).toEqual(store.get(sub.id));
    } finally { tmp.cleanup(); }
  });

  it('não altera sessões nem executa: tarefas e entregas não têm execução associada', () => {
    const { store, sub } = setup();
    const id = store.recordDelivery(sub.id, { summary: 'Pronto' }).deliveries![0].id;
    store.requestDeliveryReview(sub.id, id, GEMINI, reviewers(GEMINI));
    const final = store.decideDelivery(sub.id, id, 'approved', { justification: 'ok', decidedBy: 'human:local-ui' }, reviewers(GEMINI));
    expect(final.execution).toBeUndefined();
    expect(final.assigneeId).toBe(HENRIQUE);
  });
});
