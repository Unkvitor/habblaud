import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { QaDelivery, QaTask, TaskStatus } from '../../shared/types';
import { tr } from '../../shared/i18n';
import { DELIVERY_EVENT_TYPES, MAX_DELIVERIES_PER_TASK, MAX_JUSTIFICATION, MAX_SUMMARY, cleanEvidence, cleanText, copyDelivery, validDelivery } from './deliveries';

const MAX_TASKS = 2_000;
const MAX_DESCRIPTION = 2_000;
const OPEN = new Set<TaskStatus>(['pending', 'assigned', 'in_progress', 'blocked', 'awaiting_approval']);
const NEXT: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['assigned', 'blocked'],
  assigned: ['in_progress', 'blocked', 'awaiting_approval', 'completed'],
  in_progress: ['blocked', 'awaiting_approval', 'completed'],
  blocked: ['assigned'],
  awaiting_approval: ['assigned', 'blocked', 'completed'],
  completed: [],
};

function cleanDescription(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= MAX_DESCRIPTION ? text : undefined;
}

function isStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && value in NEXT;
}

function copy(task: QaTask): QaTask {
  return { ...task, events: task.events.map((event) => ({ ...event })), ...(task.deliveries ? { deliveries: task.deliveries.map(copyDelivery) } : {}) };
}

/** Subtarefas só aceitam entregas enquanto estão em andamento; revisão e decisão acontecem nesses estados. */
const DELIVERABLE = new Set<TaskStatus>(['assigned', 'in_progress', 'awaiting_approval']);
/** Decide se um agente pode revisar (agente QA presente com o papel persistente de revisor). Fornecida pela camada HTTP. */
export type ReviewerEligibility = (agentId: string) => boolean;

function validTask(value: unknown): value is QaTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<QaTask>;
  return (
    typeof task.id === 'string' &&
    !!cleanDescription(task.description) &&
    typeof task.assigneeId === 'string' &&
    !!task.assigneeId &&
    isStatus(task.status) &&
    typeof task.createdAt === 'number' &&
    typeof task.updatedAt === 'number' &&
    Array.isArray(task.events) &&
    task.events.every((event) => event && typeof event.id === 'string' && typeof event.at === 'number' && ['created', 'status_changed', 'delegation_proposed', 'delegation_decided', ...DELIVERY_EVENT_TYPES].includes(event.type) && isStatus(event.to) && (event.from === undefined || isStatus(event.from)) && (event.deliveryId === undefined || typeof event.deliveryId === 'string')) &&
    validDeliveries(task)
  );
}

/** Entregas são opcionais (tarefas anteriores não as têm), só existem em subtarefas e têm IDs únicos. */
function validDeliveries(task: Partial<QaTask>): boolean {
  if (task.deliveries === undefined) return true;
  const list = task.deliveries;
  return Array.isArray(list) && list.length > 0 && list.length <= MAX_DELIVERIES_PER_TASK && typeof task.parentId === 'string' && !!task.parentId &&
    list.every(validDelivery) && new Set(list.map((delivery) => delivery.id)).size === list.length;
}

export class QaTaskError extends Error {
  constructor(readonly code: 'invalid' | 'duplicate' | 'not-found' | 'invalid-transition' | 'forbidden' | 'corrupt', message: string) {
    super(message);
  }
}

/** Persistência local e atômica. Carregar tarefas nunca executa nem retoma agentes. */
export class QaTaskStore {
  private tasks = new Map<string, QaTask>();
  private listeners = new Set<() => void>();
  private corrupt = false;

  constructor(private readonly file: string | null, private readonly now: () => number = Date.now) {}

  load(): void {
    if (!this.file) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { version?: unknown; tasks?: unknown } | null;
      if (!raw || raw.version !== 1 || !Array.isArray(raw.tasks) || raw.tasks.length > MAX_TASKS || !raw.tasks.every(validTask)) {
        throw new Error('invalid QA task store');
      }
      const loaded = new Map<string, QaTask>();
      for (const task of raw.tasks) {
        if (loaded.has(task.id)) throw new Error('duplicate QA task ID');
        loaded.set(task.id, copy(task));
      }
      this.tasks = loaded;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.corrupt = true;
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): QaTask[] {
    return [...this.tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).map(copy);
  }
  get(id: string): QaTask | undefined { const task = this.tasks.get(id); return task ? copy(task) : undefined; }

  create(input: { description?: unknown; assigneeId?: unknown; parentId?: unknown; dependencies?: unknown; requesterId?: unknown; originAgentId?: unknown }): QaTask {
    this.writable();
    const description = cleanDescription(input.description);
    if (!description || typeof input.assigneeId !== 'string' || !input.assigneeId) throw new QaTaskError('invalid', tr('esperado {description, assigneeId}'));
    if (this.tasks.size >= MAX_TASKS) throw new QaTaskError('invalid', tr('limite de tarefas internas atingido'));
    const key = `${input.assigneeId}\u0000${description.normalize('NFKC').toLocaleLowerCase('pt-BR')}`;
    if ([...this.tasks.values()].some((task) => OPEN.has(task.status) && `${task.assigneeId}\u0000${task.description.normalize('NFKC').toLocaleLowerCase('pt-BR')}` === key)) {
      throw new QaTaskError('duplicate', tr('já existe uma tarefa aberta igual para este agente'));
    }
    const at = this.now();
    const parentId = typeof input.parentId === 'string' && input.parentId ? input.parentId : undefined;
    if (parentId && !this.tasks.has(parentId)) throw new QaTaskError('not-found', tr('tarefa principal não encontrada'));
    const dependencies = Array.isArray(input.dependencies) && input.dependencies.every((id) => typeof id === 'string') ? [...new Set(input.dependencies as string[])] : [];
    if (dependencies.some((id) => !this.tasks.has(id) || id === parentId || this.dependsOn(id, parentId))) throw new QaTaskError('invalid', tr('dependência de tarefa inválida ou cíclica'));
    const task: QaTask = {
      id: `qa-${randomUUID()}`,
      description,
      assigneeId: input.assigneeId,
      status: 'pending',
      createdAt: at,
      updatedAt: at,
      events: [{ id: randomUUID(), at, type: 'created', to: 'pending' }],
      ...(parentId ? { parentId } : {}), ...(dependencies.length ? { dependencies } : {}),
      ...(typeof input.requesterId === 'string' ? { requesterId: input.requesterId } : {}), ...(typeof input.originAgentId === 'string' ? { originAgentId: input.originAgentId } : {}),
    };
    this.tasks.set(task.id, task);
    this.persistAndNotify();
    return copy(task);
  }

  transition(id: string, status: unknown): QaTask {
    this.writable();
    const task = this.tasks.get(id);
    if (!task) throw new QaTaskError('not-found', tr('tarefa interna não encontrada'));
    if (!isStatus(status)) throw new QaTaskError('invalid', tr('estado de tarefa inválido'));
    if (!NEXT[task.status].includes(status)) throw new QaTaskError('invalid-transition', tr('transição de estado não permitida'));
    if (status === 'completed') this.assertCompletable(task);
    const from = task.status;
    const at = this.now();
    task.status = status;
    task.updatedAt = at;
    task.events.push({ id: randomUUID(), at, type: 'status_changed', from, to: status });
    this.persistAndNotify();
    return copy(task);
  }

  proposeDelegation(id: string, input: { toAgentId?: unknown; fromAgentId?: unknown }): QaTask {
    this.writable(); const task = this.required(id);
    if (typeof input.toAgentId !== 'string' || !input.toAgentId || task.delegation?.status === 'proposed') throw new QaTaskError('invalid', tr('proposta de delegação inválida'));
    const at = this.now(); task.delegation = { id: randomUUID(), toAgentId: input.toAgentId, ...(typeof input.fromAgentId === 'string' ? { fromAgentId: input.fromAgentId } : {}), status: 'proposed', proposedAt: at };
    task.updatedAt = at; task.events.push({ id: randomUUID(), at, type: 'delegation_proposed', to: task.status }); this.persistAndNotify(); return copy(task);
  }
  decideDelegation(id: string, decision: 'approved' | 'rejected', decidedBy: unknown): QaTask {
    this.writable(); const task = this.required(id); const delegation = task.delegation;
    if (!delegation || delegation.status !== 'proposed' || typeof decidedBy !== 'string' || !decidedBy) throw new QaTaskError('invalid-transition', tr('não há proposta pendente para decidir'));
    const at = this.now(); delegation.status = decision; delegation.decidedAt = at; delegation.decidedBy = decidedBy; task.updatedAt = at;
    task.events.push({ id: randomUUID(), at, type: 'delegation_decided', to: task.status }); this.persistAndNotify(); return copy(task);
  }
  /** Registra a entrega de uma subtarefa (resumo e referências de evidência). O autor é sempre o responsável da tarefa. */
  recordDelivery(id: string, input: { summary?: unknown; evidence?: unknown }): QaTask {
    this.writable(); const task = this.required(id); const before = copy(task);
    if (!task.parentId) throw new QaTaskError('invalid', tr('entregas só podem ser vinculadas a subtarefas'));
    if (!DELIVERABLE.has(task.status)) throw new QaTaskError('invalid-transition', tr('a subtarefa precisa estar em andamento para receber uma entrega'));
    const summary = cleanText(input.summary, MAX_SUMMARY); const evidence = cleanEvidence(input.evidence);
    if (!summary || !evidence) throw new QaTaskError('invalid', tr('entrega inválida: informe um resumo e referências de evidência válidas'));
    const list = task.deliveries ?? [];
    if (list.some((delivery) => delivery.status === 'draft' || delivery.status === 'in_review')) throw new QaTaskError('invalid-transition', tr('já existe uma entrega em andamento nesta subtarefa'));
    if (list.length >= MAX_DELIVERIES_PER_TASK) throw new QaTaskError('invalid', tr('limite de entregas da subtarefa atingido'));
    const at = this.now();
    const delivery: QaDelivery = { id: randomUUID(), submittedBy: task.assigneeId, summary, evidence, status: 'draft', createdAt: at, updatedAt: at,
      history: [{ id: randomUUID(), at, type: 'delivery_recorded', actorId: task.assigneeId }] };
    task.deliveries = [...list, delivery]; task.updatedAt = at;
    task.events.push({ id: randomUUID(), at, type: 'delivery_recorded', to: task.status, deliveryId: delivery.id });
    this.commit(task, before); return copy(task);
  }

  /**
   * Encaminha a entrega a um revisor com o papel persistente adequado. Não envia mensagem nem aciona o revisor.
   * Uma entrega já em revisão só pode ser reencaminhada quando o revisor vinculado deixou de ser elegível (ausente ou sem o papel);
   * sem isso ela ficaria presa, pois só existe uma entrega em andamento por subtarefa.
   */
  requestDeliveryReview(id: string, deliveryId: string, reviewerId: unknown, eligible: ReviewerEligibility): QaTask {
    this.writable(); const task = this.required(id); const before = copy(task); const delivery = this.deliveryOf(task, deliveryId);
    const reassign = delivery.status === 'in_review' && !!delivery.reviewerId && !eligible(delivery.reviewerId);
    if (delivery.status === 'in_review' && !reassign) throw new QaTaskError('invalid-transition', tr('a entrega já está em revisão com um revisor presente'));
    if (delivery.status !== 'draft' && !reassign) throw new QaTaskError('invalid-transition', tr('a entrega não está em rascunho'));
    if (typeof reviewerId !== 'string' || !reviewerId || reviewerId.length > 256) throw new QaTaskError('invalid', tr('revisor inválido'));
    if (reviewerId === task.assigneeId) throw new QaTaskError('forbidden', tr('o responsável pela subtarefa não pode revisar a própria entrega'));
    if (!eligible(reviewerId)) throw new QaTaskError('forbidden', tr('o revisor precisa ser um agente QA presente com o papel de investigador e revisor'));
    if (!DELIVERABLE.has(task.status)) throw new QaTaskError('invalid-transition', tr('a subtarefa precisa estar em andamento para ir à revisão'));
    this.assertDependenciesDone(task);
    const at = this.now();
    if (task.status !== 'awaiting_approval') { task.events.push({ id: randomUUID(), at, type: 'status_changed', from: task.status, to: 'awaiting_approval' }); task.status = 'awaiting_approval'; }
    delivery.status = 'in_review'; delivery.reviewerId = reviewerId; delivery.updatedAt = at;
    delivery.history.push({ id: randomUUID(), at, type: 'delivery_review_requested', actorId: task.assigneeId, note: reviewerId });
    task.updatedAt = at; task.events.push({ id: randomUUID(), at, type: 'delivery_review_requested', to: task.status, deliveryId });
    this.commit(task, before); return copy(task);
  }

  /** Registra a decisão humana sobre a entrega em revisão, sempre com justificativa. Devolver reabre a subtarefa para ajustes. */
  decideDelivery(id: string, deliveryId: string, decision: 'approved' | 'returned', input: { justification?: unknown; decidedBy?: unknown }, eligible: ReviewerEligibility): QaTask {
    this.writable(); const task = this.required(id); const before = copy(task); const delivery = this.deliveryOf(task, deliveryId);
    if (delivery.status !== 'in_review' || !delivery.reviewerId) throw new QaTaskError('invalid-transition', tr('a entrega não está aguardando revisão'));
    const justification = cleanText(input.justification, MAX_JUSTIFICATION);
    if (!justification) throw new QaTaskError('invalid', tr('a decisão exige uma justificativa'));
    if (typeof input.decidedBy !== 'string' || !input.decidedBy || input.decidedBy.length > 256) throw new QaTaskError('invalid', tr('identidade de decisão inválida'));
    if (!eligible(delivery.reviewerId)) throw new QaTaskError('forbidden', tr('o revisor vinculado não está mais presente com o papel de investigador e revisor'));
    const at = this.now(); const type = decision === 'approved' ? 'delivery_approved' : 'delivery_returned';
    delivery.status = decision; delivery.justification = justification; delivery.decidedBy = input.decidedBy; delivery.reviewedAt = at; delivery.updatedAt = at;
    delivery.history.push({ id: randomUUID(), at, type, actorId: input.decidedBy, note: justification });
    task.updatedAt = at; task.events.push({ id: randomUUID(), at, type, to: task.status, deliveryId });
    if (decision === 'returned' && task.status === 'awaiting_approval') { task.events.push({ id: randomUUID(), at, type: 'status_changed', from: 'awaiting_approval', to: 'assigned' }); task.status = 'assigned'; }
    this.commit(task, before); return copy(task);
  }

  private deliveryOf(task: QaTask, deliveryId: string): QaDelivery {
    const delivery = task.deliveries?.find((value) => value.id === deliveryId);
    if (!delivery) throw new QaTaskError('not-found', tr('entrega não encontrada'));
    return delivery;
  }
  private assertDependenciesDone(task: QaTask): void {
    if (task.dependencies?.some((dep) => this.tasks.get(dep)?.status !== 'completed')) throw new QaTaskError('invalid-transition', tr('há dependências ainda não concluídas'));
  }
  /** Conclusão exige dependências prontas, nenhuma subtarefa aberta e, em subtarefas, a última entrega aprovada. */
  private assertCompletable(task: QaTask): void {
    this.assertDependenciesDone(task);
    if ([...this.tasks.values()].some((other) => other.parentId === task.id && other.status !== 'completed')) throw new QaTaskError('invalid-transition', tr('há subtarefas ainda não concluídas'));
    if (task.parentId && task.deliveries?.[task.deliveries.length - 1]?.status !== 'approved') throw new QaTaskError('invalid-transition', tr('a subtarefa só conclui com a última entrega aprovada'));
  }
  private required(id: string): QaTask { const task = this.tasks.get(id); if (!task) throw new QaTaskError('not-found', tr('tarefa interna não encontrada')); return task; }
  private writable(): void { if (this.corrupt) throw new QaTaskError('corrupt', tr('arquivo de tarefas corrompido; recupere-o antes de alterar dados')); }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, tasks: this.list() }), { mode: 0o600 });
    renameSync(temp, this.file);
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
  private persistAndNotify(): void { this.persist(); this.notify(); }
  /** Grava uma alteração de entrega; se a gravação falhar, a memória volta ao estado anterior (igual ao disco) antes de propagar o erro. */
  private commit(task: QaTask, before: QaTask): void {
    try { this.persist(); } catch (error) { this.tasks.set(task.id, before); throw error; }
    this.notify();
  }
  private dependsOn(id: string, sought: string | undefined, seen = new Set<string>()): boolean {
    if (!sought || id === sought || seen.has(id)) return id === sought;
    seen.add(id); const task = this.tasks.get(id); return !!task?.dependencies?.some((dep) => this.dependsOn(dep, sought, seen));
  }
}
