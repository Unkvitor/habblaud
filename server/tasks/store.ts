import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { QaTask, TaskStatus } from '../../shared/types';
import { tr } from '../../shared/i18n';

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
  return { ...task, events: task.events.map((event) => ({ ...event })) };
}

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
    task.events.every((event) => event && typeof event.id === 'string' && typeof event.at === 'number' && (event.type === 'created' || event.type === 'status_changed') && isStatus(event.to) && (event.from === undefined || isStatus(event.from)))
  );
}

export class QaTaskError extends Error {
  constructor(readonly code: 'invalid' | 'duplicate' | 'not-found' | 'invalid-transition', message: string) {
    super(message);
  }
}

/** Persistência local e atômica. Carregar tarefas nunca executa nem retoma agentes. */
export class QaTaskStore {
  private tasks = new Map<string, QaTask>();
  private listeners = new Set<() => void>();

  constructor(private readonly file: string | null, private readonly now: () => number = Date.now) {}

  load(): void {
    if (!this.file) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { version?: unknown; tasks?: unknown };
      if (raw.version !== 1 || !Array.isArray(raw.tasks)) return;
      for (const task of raw.tasks) if (validTask(task) && this.tasks.size < MAX_TASKS) this.tasks.set(task.id, copy(task));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): QaTask[] {
    return [...this.tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).map(copy);
  }

  create(input: { description?: unknown; assigneeId?: unknown }): QaTask {
    const description = cleanDescription(input.description);
    if (!description || typeof input.assigneeId !== 'string' || !input.assigneeId) throw new QaTaskError('invalid', tr('esperado {description, assigneeId}'));
    if (this.tasks.size >= MAX_TASKS) throw new QaTaskError('invalid', tr('limite de tarefas internas atingido'));
    const key = `${input.assigneeId}\u0000${description.normalize('NFKC').toLocaleLowerCase('pt-BR')}`;
    if ([...this.tasks.values()].some((task) => OPEN.has(task.status) && `${task.assigneeId}\u0000${task.description.normalize('NFKC').toLocaleLowerCase('pt-BR')}` === key)) {
      throw new QaTaskError('duplicate', tr('já existe uma tarefa aberta igual para este agente'));
    }
    const at = this.now();
    const task: QaTask = {
      id: `qa-${randomUUID()}`,
      description,
      assigneeId: input.assigneeId,
      status: 'pending',
      createdAt: at,
      updatedAt: at,
      events: [{ id: randomUUID(), at, type: 'created', to: 'pending' }],
    };
    this.tasks.set(task.id, task);
    this.persistAndNotify();
    return copy(task);
  }

  transition(id: string, status: unknown): QaTask {
    const task = this.tasks.get(id);
    if (!task) throw new QaTaskError('not-found', tr('tarefa interna não encontrada'));
    if (!isStatus(status)) throw new QaTaskError('invalid', tr('estado de tarefa inválido'));
    if (!NEXT[task.status].includes(status)) throw new QaTaskError('invalid-transition', tr('transição de estado não permitida'));
    const from = task.status;
    const at = this.now();
    task.status = status;
    task.updatedAt = at;
    task.events.push({ id: randomUUID(), at, type: 'status_changed', from, to: status });
    this.persistAndNotify();
    return copy(task);
  }

  private persistAndNotify(): void {
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({ version: 1, tasks: this.list() }), { mode: 0o600 });
      renameSync(temp, this.file);
    }
    for (const listener of this.listeners) listener();
  }
}
