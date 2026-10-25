import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentInfo } from '../../shared/types';
import { HttpError, readJson, sendJson } from '../http/app';
import { QaTaskError, QaTaskStore } from './store';
import { tr } from '../../shared/i18n';

function supportedAssignee(agent: AgentInfo | undefined): boolean {
  return !!agent && agent.kind === 'main' && (agent.provider === 'codex' || agent.provider === 'antigravity');
}

export function handleQaTasks(req: IncomingMessage, res: ServerResponse, path: string, store: QaTaskStore, agent: (id: string) => AgentInfo | undefined): void {
  const method = req.method ?? 'GET';
  if (path === '/api/qa-tasks') {
    if (method === 'GET') return void sendJson(res, 200, { tasks: store.list() });
    if (method !== 'POST') return void methodNotAllowed(res, 'GET, POST');
    readJson(req).then((body) => {
      const input = body as { description?: unknown; assigneeId?: unknown };
      if (!supportedAssignee(typeof input.assigneeId === 'string' ? agent(input.assigneeId) : undefined)) throw new HttpError(400, tr('responsável precisa ser um agente Codex ou Antigravity existente'));
      sendJson(res, 201, { task: store.create(input) });
    }).catch((error) => sendTaskError(res, error));
    return;
  }
  const match = /^\/api\/qa-tasks\/([^/]+)$/.exec(path);
  if (!match) return void sendJson(res, 404, { error: tr('rota desconhecida') });
  if (method !== 'PATCH') return void methodNotAllowed(res, 'PATCH');
  readJson(req).then((body) => sendJson(res, 200, { task: store.transition(decodeURIComponent(match[1]), (body as { status?: unknown }).status) })).catch((error) => sendTaskError(res, error));
}

function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader('Allow', allow);
  sendJson(res, 405, { error: tr('método não permitido') });
}

function sendTaskError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) return void sendJson(res, error.status, { error: error.message });
  if (error instanceof QaTaskError) {
    const status = error.code === 'not-found' ? 404 : error.code === 'duplicate' || error.code === 'invalid-transition' ? 409 : 400;
    return void sendJson(res, status, { error: error.message });
  }
  sendJson(res, 500, { error: tr('erro interno') });
}
