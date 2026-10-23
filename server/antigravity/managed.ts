import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

export type AntigravitySessionStatus =
  | 'idle'
  | 'working'
  | 'closed'
  | 'error';

export type AntigravitySession = {
  id: string;
  cwd: string;
  status: AntigravitySessionStatus;
  createdAt: number;
};

export type AntigravityLauncher = (
  session: AntigravitySession,
  text: string
) => Promise<void> | void;

export type ManagedAntigravityOptions = {
  workspace: string;
  launch?: AntigravityLauncher;
};

function insideWorkspace(
  requested: string,
  root: string
): boolean {
  const rel = relative(root, requested);

  return (
    rel === '' ||
    (
      rel !== '..' &&
      !rel.startsWith('..' + sep) &&
      !rel.startsWith(sep)
    )
  );
}

export class ManagedAntigravity extends EventEmitter {
  private readonly sessions =
    new Map<string, AntigravitySession>();

  private readonly busy = new Set<string>();

  private readonly workspace: string;

  private readonly launch?: AntigravityLauncher;

  constructor(options: ManagedAntigravityOptions) {
    super();

    if (!options.workspace?.trim()) {
      throw new Error('Workspace obrigatório.');
    }

    this.workspace = resolve(options.workspace);
    this.launch = options.launch;
  }

  list(): AntigravitySession[] {
    return [...this.sessions.values()].map(
      session => ({ ...session })
    );
  }

  create(requestedCwd?: string): AntigravitySession {
    const root = realpathSync(this.workspace);

    const cwd = realpathSync(
      requestedCwd ?? this.workspace
    );

    if (!insideWorkspace(cwd, root)) {
      throw new Error(
        'Sessão fora do workspace permitido.'
      );
    }

    const session: AntigravitySession = {
      id: randomUUID(),
      cwd,
      status: 'idle',
      createdAt: Date.now(),
    };

    this.sessions.set(session.id, session);

    this.emit('update', {
      method: 'session/created',
      sessionId: session.id,
      status: session.status,
    });

    return { ...session };
  }

  async send(
    sessionId: string,
    text: string
  ): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session || session.status === 'closed') {
      throw new Error(
        'Sessão inexistente ou encerrada.'
      );
    }

    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 32000
    ) {
      throw new Error(
        'Mensagem vazia ou longa demais.'
      );
    }

    if (this.busy.has(sessionId)) {
      throw new Error(
        'Já existe uma mensagem em processamento.'
      );
    }

    if (!this.launch) {
      throw new Error(
        'Execução real do Antigravity não habilitada.'
      );
    }

    this.busy.add(sessionId);
    session.status = 'working';

    this.emit('update', {
      method: 'session/working',
      sessionId,
    });

    try {
      await this.launch({ ...session }, text);

      session.status = 'idle';

      this.emit('update', {
        method: 'session/completed',
        sessionId,
      });
    } catch {
      session.status = 'error';

      this.emit('update', {
        method: 'session/error',
        sessionId,
        error: 'Falha no processamento da mensagem.',
      });

      throw new Error(
        'Falha no processamento da mensagem.'
      );
    } finally {
      this.busy.delete(sessionId);
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error('Sessão inexistente.');
    }

    if (this.busy.has(sessionId)) {
      throw new Error(
        'Não é possível encerrar uma sessão ocupada.'
      );
    }

    session.status = 'closed';

    this.emit('update', {
      method: 'session/closed',
      sessionId,
    });
  }
}
