import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

export type AntigravitySessionStatus =
  | 'idle'
  | 'working'
  | 'closed'
  | 'error';

export type AntigravityRole = 'user' | 'assistant';

export type AntigravityMessage = {
  id: string;
  role: AntigravityRole;
  text: string;
  createdAt: number;
  complete: boolean;
};

export type AntigravitySession = {
  id: string;
  cwd: string;
  status: AntigravitySessionStatus;
  createdAt: number;
};

export type AntigravityEvent = {
  method: string;
  sessionId: string;
  status?: AntigravitySessionStatus;
  message?: AntigravityMessage;
  delta?: string;
  error?: string;
};

export type AntigravityLauncher = (
  session: AntigravitySession,
  text: string,
  onChunk?: (chunk: string) => void
) => Promise<void> | void;

export type ManagedAntigravityOptions = {
  workspace: string;
  launch?: AntigravityLauncher;
  maxSessions?: number;
  maxMessages?: number;
};

const MAX_INPUT = 32000;
const MAX_OUTPUT = 64000;

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

function validLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000) {
    throw new RangeError(`${name} inválido.`);
  }

  return value;
}

export class ManagedAntigravity extends EventEmitter {
  private readonly sessions =
    new Map<string, AntigravitySession>();

  private readonly histories =
    new Map<string, AntigravityMessage[]>();

  private readonly busy = new Set<string>();

  private readonly workspace: string;
  private readonly launch?: AntigravityLauncher;
  private readonly maxSessions: number;
  private readonly maxMessages: number;

  constructor(options: ManagedAntigravityOptions) {
    super();

    if (!options.workspace?.trim()) {
      throw new Error('Workspace obrigatório.');
    }

    this.workspace = resolve(options.workspace);
    this.launch = options.launch;
    this.maxSessions = validLimit(
      options.maxSessions ?? 20,
      'Limite de sessões'
    );
    this.maxMessages = validLimit(
      options.maxMessages ?? 200,
      'Limite de mensagens'
    );
  }

  private publish(event: AntigravityEvent): void {
    this.emit('update', event);
  }

  private requireSession(id: string): AntigravitySession {
    const session = this.sessions.get(id);

    if (!session) {
      throw new Error('Sessão inexistente.');
    }

    return session;
  }

  private addMessage(
    sessionId: string,
    role: AntigravityRole,
    text: string,
    complete: boolean
  ): AntigravityMessage {
    const history = this.histories.get(sessionId);

    if (!history) {
      throw new Error('Histórico inexistente.');
    }

    const message: AntigravityMessage = {
      id: randomUUID(),
      role,
      text,
      createdAt: Date.now(),
      complete,
    };

    history.push(message);

    while (history.length > this.maxMessages) {
      history.shift();
    }

    this.publish({
      method: 'message/created',
      sessionId,
      message: { ...message },
    });

    return message;
  }

  list(): AntigravitySession[] {
    return [...this.sessions.values()].map(
      session => ({ ...session })
    );
  }

  history(sessionId: string): AntigravityMessage[] {
    this.requireSession(sessionId);

    return (
      this.histories.get(sessionId) ?? []
    ).map(message => ({ ...message }));
  }

  create(requestedCwd?: string): AntigravitySession {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error('Limite de sessões atingido.');
    }

    const root = realpathSync(this.workspace);
    const cwd = realpathSync(
      requestedCwd ?? this.workspace
    );

    if (!insideWorkspace(cwd, root)) {
      throw new Error('Sessão fora do workspace permitido.');
    }

    const session: AntigravitySession = {
      id: randomUUID(),
      cwd,
      status: 'idle',
      createdAt: Date.now(),
    };

    this.sessions.set(session.id, session);
    this.histories.set(session.id, []);

    this.publish({
      method: 'session/created',
      sessionId: session.id,
      status: 'idle',
    });

    return { ...session };
  }

  async send(
    sessionId: string,
    text: string
  ): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session || session.status === 'closed') {
      throw new Error('Sessão inexistente ou encerrada.');
    }

    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > MAX_INPUT
    ) {
      throw new Error('Mensagem vazia ou longa demais.');
    }

    if (this.busy.has(sessionId)) {
      throw new Error('Já existe uma mensagem em processamento.');
    }

    if (session.status === 'error') {
      throw new Error('Sessão em erro; recuperação necessária.');
    }

    if (!this.launch) {
      throw new Error(
        'Execução real do Antigravity não habilitada.'
      );
    }

    const currentRoot = realpathSync(this.workspace);
    const currentCwd = realpathSync(session.cwd);

    if (!insideWorkspace(currentCwd, currentRoot)) {
      throw new Error('Workspace da sessão não é mais permitido.');
    }

    this.busy.add(sessionId);
    session.status = 'working';

    this.addMessage(sessionId, 'user', text, true);

    this.publish({
      method: 'session/working',
      sessionId,
      status: 'working',
    });

    let answer: AntigravityMessage | undefined;
    let active = true;

    const onChunk = (chunk: string): void => {
      if (!active) return;

      if (typeof chunk !== 'string') {
        throw new Error('Fragmento de resposta inválido.');
      }

      if (!chunk) return;

      const nextSize = (answer?.text.length ?? 0) + chunk.length;

      if (nextSize > MAX_OUTPUT) {
        throw new Error('Resposta excede o limite permitido.');
      }

      if (!answer) {
        answer = this.addMessage(
          sessionId,
          'assistant',
          '',
          false
        );
      }

      answer.text += chunk;

      this.publish({
        method: 'message/delta',
        sessionId,
        message: { ...answer },
        delta: chunk,
      });
    };

    try {
      await this.launch(
        { ...session },
        text,
        onChunk
      );

      active = false;

      if (answer) {
        answer.complete = true;

        this.publish({
          method: 'message/completed',
          sessionId,
          message: { ...answer },
        });
      }

      session.status = 'idle';

      this.publish({
        method: 'session/completed',
        sessionId,
        status: 'idle',
      });
    } catch {
      active = false;

      // Uma resposta interrompida continua marcada como incompleta.
      session.status = 'error';

      this.publish({
        method: 'session/error',
        sessionId,
        status: 'error',
        error: 'Falha no processamento da mensagem.',
      });

      throw new Error('Falha no processamento da mensagem.');
    } finally {
      active = false;
      this.busy.delete(sessionId);
    }
  }

  recover(sessionId: string): void {
    const session = this.requireSession(sessionId);

    if (this.busy.has(sessionId)) {
      throw new Error('Sessão ocupada.');
    }

    if (session.status !== 'error') {
      throw new Error('Sessão não está em erro.');
    }

    session.status = 'idle';

    this.publish({
      method: 'session/recovered',
      sessionId,
      status: 'idle',
    });
  }

  close(sessionId: string): void {
    const session = this.requireSession(sessionId);

    if (this.busy.has(sessionId)) {
      throw new Error(
        'Não é possível encerrar uma sessão ocupada.'
      );
    }

    session.status = 'closed';

    this.publish({
      method: 'session/closed',
      sessionId,
      status: 'closed',
    });
  }
}
