import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentInfo } from '../../shared/types';
import { HttpError, readJson, sendJson } from '../http/app';
import { QaTaskError, QaTaskStore } from './store';
import type { QaRoleStore } from './roles';
import { tr } from '../../shared/i18n';

function supportedAssignee(agent: AgentInfo | undefined): boolean {
  return !!agent && agent.kind === 'main' && (agent.provider === 'codex' || agent.provider === 'antigravity');
}

/** Identidade registrada nas decisões feitas pela interface local. O corpo da requisição nunca a define; localhost não autentica uma pessoa. */
export const LOCAL_DECISION_IDENTITY = 'human:local-ui';

function pathId(raw: string): string | undefined {
  try { return decodeURIComponent(raw); } catch { return undefined; }
}

export function handleQaTasks(req: IncomingMessage, res: ServerResponse, path: string, store: QaTaskStore, agent: (id: string) => AgentInfo | undefined, roles?: QaRoleStore): void {
  const method = req.method ?? 'GET';
  // Revisor elegível: agente QA principal presente com o papel persistente de investigador e revisor.
  const eligibleReviewer = (id: string): boolean => supportedAssignee(agent(id)) && roles?.get(id)?.role === 'investigator_reviewer';
  if (path === '/api/qa-tasks') {
    if (method === 'GET') return void sendJson(res, 200, { tasks: store.list() });
    if (method !== 'POST') return void methodNotAllowed(res, 'GET, POST');
    readJson(req).then((body) => {
      const input = body as { description?: unknown; assigneeId?: unknown; parentId?: unknown; dependencies?: unknown; requesterId?: unknown; originAgentId?: unknown };
      if (!supportedAssignee(typeof input.assigneeId === 'string' ? agent(input.assigneeId) : undefined)) throw new HttpError(400, tr('responsável precisa ser um agente Codex ou Antigravity existente'));
      sendJson(res, 201, { task: store.create(input) });
    }).catch((error) => sendTaskError(res, error));
    return;
  }
  const deliveries = /^\/api\/qa-tasks\/([^/]+)\/deliveries(?:\/([^/]+)\/(review-request|decision))?$/.exec(path);
  if (deliveries) {
    if (method !== 'POST') return void methodNotAllowed(res, 'POST');
    const taskId = pathId(deliveries[1]); const deliveryId = deliveries[2] === undefined ? undefined : pathId(deliveries[2]);
    if (!taskId || (deliveries[2] !== undefined && !deliveryId)) return void sendJson(res, 400, { error: tr('identificador inválido') });
    readJson(req).then((body) => {
      const value = (body && typeof body === 'object' ? body : {}) as { summary?: unknown; evidence?: unknown; reviewerId?: unknown; action?: unknown; justification?: unknown };
      if (!deliveryId) return void sendJson(res, 201, { task: store.recordDelivery(taskId, value) });
      if (deliveries[3] === 'review-request') return void sendJson(res, 200, { task: store.requestDeliveryReview(taskId, deliveryId, value.reviewerId, eligibleReviewer) });
      if (value.action !== 'approve' && value.action !== 'return') throw new QaTaskError('invalid', tr('ação de entrega inválida'));
      sendJson(res, 200, { task: store.decideDelivery(taskId, deliveryId, value.action === 'approve' ? 'approved' : 'returned', { justification: value.justification, decidedBy: LOCAL_DECISION_IDENTITY }, eligibleReviewer) });
    }).catch((error) => sendTaskError(res, error));
    return;
  }
  const delegation = /^\/api\/qa-tasks\/([^/]+)\/delegation$/.exec(path);
  if (delegation) {
    if (method !== 'POST') return void methodNotAllowed(res, 'POST');
    readJson(req).then((body) => {
      const value = body as { action?: unknown; toAgentId?: unknown; fromAgentId?: unknown; decidedBy?: unknown };
      const task = value.action === 'propose' ? store.proposeDelegation(decodeURIComponent(delegation[1]), value) :
        (value.action === 'approve' || value.action === 'reject') ? store.decideDelegation(decodeURIComponent(delegation[1]), value.action === 'approve' ? 'approved' : 'rejected', value.decidedBy) : (() => { throw new QaTaskError('invalid', tr('ação de delegação inválida')); })();
      sendJson(res, 200, { task });
    }).catch((error) => sendTaskError(res, error)); return;
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
    const status = error.code === 'not-found' ? 404 : error.code === 'forbidden' ? 403 : error.code === 'duplicate' || error.code === 'invalid-transition' ? 409 : 400;
    return void sendJson(res, status, { error: error.message });
  }
  sendJson(res, 500, { error: tr('erro interno') });
}
