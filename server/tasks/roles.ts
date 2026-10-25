import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tr } from '../../shared/i18n';

/** Papéis de trabalho informativos: não concedem autorização nem iniciam execuções. */
export type QaRoleId = 'coordinator' | 'automation_engineer' | 'investigator_reviewer';
export interface QaRoleAssignment {
  agentId: string;
  role: QaRoleId;
  updatedAt: number;
}

const ROLE_IDS: ReadonlySet<string> = new Set(['coordinator', 'automation_engineer', 'investigator_reviewer']);
const MAX_ROLES = 64;

function isAssignment(value: unknown): value is QaRoleAssignment {
  if (!value || typeof value !== 'object') return false;
  const a = value as Partial<QaRoleAssignment>;
  return typeof a.agentId === 'string' && a.agentId.trim() === a.agentId && a.agentId.length > 0 && a.agentId.length <= 256 &&
    typeof a.role === 'string' && ROLE_IDS.has(a.role) &&
    typeof a.updatedAt === 'number' && Number.isFinite(a.updatedAt);
}

export class QaRoleError extends Error {
  constructor(readonly code: 'invalid' | 'corrupt' | 'limit', message: string) { super(message); }
}

/** Vínculo persistente com ID existente; não altera AgentInfo, NameStore nem threads. */
export class QaRoleStore {
  private assignments = new Map<string, QaRoleAssignment>();
  private corrupt = false;

  constructor(private readonly file: string | null, private readonly now: () => number = Date.now) {}

  load(): void {
    if (!this.file) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as { version?: unknown; roles?: unknown };
      if (parsed.version !== 1 || !Array.isArray(parsed.roles) || parsed.roles.length > MAX_ROLES ||
        !parsed.roles.every(isAssignment)) throw new Error('invalid format');
      const loaded = new Map<string, QaRoleAssignment>();
      for (const role of parsed.roles) {
        if (loaded.has(role.agentId)) throw new Error('duplicate agent ID');
        loaded.set(role.agentId, { ...role });
      }
      this.assignments = loaded;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.corrupt = true;
    }
  }

  list(): QaRoleAssignment[] {
    return [...this.assignments.values()].sort((a, b) => a.agentId.localeCompare(b.agentId)).map((a) => ({ ...a }));
  }
  get(agentId: string): QaRoleAssignment | undefined {
    const role = this.assignments.get(agentId);
    return role ? { ...role } : undefined;
  }

  assign(agentId: unknown, role: unknown): QaRoleAssignment {
    this.writable();
    if (typeof agentId !== 'string' || !agentId.trim() || agentId.trim() !== agentId || agentId.length > 256 ||
      typeof role !== 'string' || !ROLE_IDS.has(role)) throw new QaRoleError('invalid', tr('agente ou papel QA inválido'));
    const previous = this.assignments.get(agentId);
    if (previous?.role === role) return { ...previous };
    if (!previous && this.assignments.size >= MAX_ROLES) throw new QaRoleError('limit', tr('limite de papéis QA atingido'));
    const updated: QaRoleAssignment = { agentId, role: role as QaRoleId, updatedAt: this.now() };
    const next = new Map(this.assignments);
    next.set(agentId, updated);
    this.persist(next);
    this.assignments = next;
    return { ...updated };
  }

  remove(agentId: string): boolean {
    this.writable();
    if (!this.assignments.has(agentId)) return false;
    const next = new Map(this.assignments);
    next.delete(agentId);
    this.persist(next);
    this.assignments = next;
    return true;
  }

  private writable(): void {
    if (this.corrupt) throw new QaRoleError('corrupt', tr('arquivo de papéis QA inválido; gravações bloqueadas'));
  }

  private persist(next: ReadonlyMap<string, QaRoleAssignment>): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    const roles = [...next.values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
    writeFileSync(temp, JSON.stringify({ version: 1, roles }), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}
