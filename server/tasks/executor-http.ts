import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson } from '../http/app';
import { DeterministicSimulator, ExecutionError, SupervisedExecutor } from './executor';
import type { QaTaskStore } from './store';
import type { RealCodexExecutor } from './real-executor';

export function handleSimulatedExecutions(req: IncomingMessage, res: ServerResponse, path: string, queue: SupervisedExecutor, tasks: QaTaskStore,
  agent: (id: string) => boolean, real?: RealCodexExecutor, threadOf?: (id: string) => string | undefined): void {
  const verb = req.method ?? 'GET'; const base = '/api/qa-executions';
  if (path === base) {
    if (verb === 'GET') return void sendJson(res, 200, { executions: queue.list(), realAvailable: !!real });
    if (verb !== 'POST') return void method(res, 'GET, POST');
    return void readJson(req).then((body: any) => {
      const mode = body?.mode === 'real' ? 'real' : 'simulated';
      if (mode === 'real' && !real) throw new HttpError(403, 'execucao Codex real desligada; habilite o opt-in do executor');
      if (!body || typeof body.taskId !== 'string' || typeof body.executorId !== 'string' || typeof body.threadId !== 'string' || typeof body.idempotencyKey !== 'string' || typeof body.planHash !== 'string') throw new HttpError(400, 'plano invalido');
      if (mode === 'simulated' && !/^simulated:[\w.-]+$/.test(body.identity ?? '')) throw new HttpError(400, 'plano simulado invalido');
      if (mode === 'real' && (typeof body.scope !== 'string' || !body.scope.trim() || body.scope.length > 2000 || !/^\w{8}-\w{4}-[1-5]\w{3}-[89abAB]\w{3}-\w{12}$/.test(body.threadId) || threadOf?.(body.executorId) !== body.threadId || /\b(rm\s+-rf|git\s+(push|reset)|sudo|jira|gitlab|pipeline|producao)\b/i.test(body.scope))) throw new HttpError(400, 'escopo ou thread real invalido');
      const task = tasks.get(body.taskId);
      if (!task || !agent(body.executorId) || task.assigneeId !== body.executorId) throw new HttpError(400, 'tarefa ou executor invalido');
      if (task.dependencies?.some(id => tasks.get(id)?.status !== 'completed')) throw new HttpError(409, 'dependencias pendentes');
      sendJson(res, 201, { execution: queue.enqueue({ ...body, mode, ...(mode === 'real' ? { scope: body.scope } : {}) }) });
    }).catch(e => fail(res, e));
  }
  const match = new RegExp(`^${base}/([^/]+)(?:/(authorize|authorize-real|simulate|execute|cancel))?$`).exec(path);
  if (!match) return void sendJson(res, 404, { error: 'rota desconhecida' });
  if (!match[2]) {
    if (verb !== 'GET') return void method(res, 'GET');
    const execution = queue.list().find(value => value.id === decodeURIComponent(match[1]));
    return void sendJson(res, execution ? 200 : 404, execution ? { execution } : { error: 'execucao desconhecida' });
  }
  if (verb !== 'POST') return void method(res, 'POST');
  readJson(req).then((body: any) => {
    const id = decodeURIComponent(match[1]); let execution;
    if (match[2] === 'authorize') {
      if (!/^simulated:[\w.-]+$/.test(body.identity ?? '')) throw new HttpError(403, 'somente identidade simulada');
      execution = queue.authorize(id, body.identity, body.planHash);
    } else if (match[2] === 'authorize-real') {
      if (!real) throw new HttpError(403, 'execucao Codex real desligada');
      execution = queue.authorizeHuman(id, body.identity, body.planHash);
    } else if (match[2] === 'simulate') {
      if (!['success', 'failure', 'timeout', 'cancelled'].includes(body.outcome)) throw new HttpError(400, 'resultado simulado invalido');
      execution = new DeterministicSimulator(queue).run(id, body.outcome);
    } else if (match[2] === 'execute') {
      if (!real) throw new HttpError(403, 'execucao Codex real desligada');
      const value = queue.list().find(item => item.id === id);
      if (!value || value.mode !== 'real' || value.authorizationKind !== 'human' || value.state !== 'ready') throw new HttpError(409, 'execucao real nao esta autorizada');
      void real.run(id).catch(() => {}); return sendJson(res, 202, { execution: value });
    } else {
      const value = queue.list().find(item => item.id === id);
      if (real && value?.mode === 'real') { void real.cancel(id).catch(() => {}); return sendJson(res, 202, { execution: value }); }
      execution = queue.cancel(id);
    }
    sendJson(res, 200, { execution });
  }).catch(e => fail(res, e));
}
function method(res: ServerResponse, allow: string): void { res.setHeader('Allow', allow); sendJson(res, 405, { error: 'metodo nao permitido' }); }
function fail(res: ServerResponse, error: unknown): void { const status = error instanceof HttpError ? error.status : error instanceof ExecutionError ? (error.code === 'conflict' ? 409 : 400) : 500; sendJson(res, status, { error: error instanceof Error ? error.message : 'erro interno' }); }
