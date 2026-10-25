import type { Json } from '../codex/managed';
import type { ManagedCodex } from '../codex/managed';
import { ExecutionError, SupervisedExecutor } from './executor';

/** Glue between the existing supervised queue and the existing native Codex App Server transport. */
export class RealCodexExecutor {
  constructor(private readonly queue: SupervisedExecutor, private readonly codex: ManagedCodex) {}

  async run(id: string): Promise<void> {
    const execution = this.queue.list().find((value) => value.id === id);
    if (!execution || execution.mode !== 'real' || execution.authorizationKind !== 'human' || execution.state !== 'ready') {
      throw new ExecutionError('invalid', 'execucao real nao autorizada');
    }
    this.queue.start(id);
    try {
      const result = await this.codex.execute(execution.threadId, execution.scope ?? '', (event) => this.progress(id, event));
      this.queue.finish(id, 'completed', typeof result.text === 'string' ? result.text : 'turn/completed');
    } catch (error) {
      const current = this.queue.list().find((value) => value.id === id);
      if (current?.state === 'cancel_requested') this.queue.finish(id, 'cancelled', 'execucao cancelada pelo operador');
      else this.queue.finish(id, 'failed', error instanceof Error ? error.message : 'falha no App Server');
      throw error;
    }
  }

  async cancel(id: string): Promise<void> {
    const execution = this.queue.list().find((value) => value.id === id);
    if (!execution || execution.mode !== 'real') throw new ExecutionError('invalid', 'execucao real desconhecida');
    this.queue.cancel(id);
    if (execution.state === 'running') await this.codex.interrupt(execution.threadId);
  }

  private progress(id: string, event: Json): void {
    const detail = typeof event.text === 'string' ? event.text : event.method;
    if (detail) this.queue.checkpoint(id, String(detail).slice(-8_000));
  }
}
