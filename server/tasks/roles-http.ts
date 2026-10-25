import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentInfo } from '../../shared/types';
import { HttpError, readJson, sendJson } from '../http/app';
import { tr } from '../../shared/i18n';
import { QaRoleError, QaRoleStore } from './roles';

/** API de configuração informativa. Não modifica os agentes ou suas permissões. */
export function handleQaRoles(req: IncomingMessage, res: ServerResponse, path: string, roles: QaRoleStore, agent: (id: string) => AgentInfo | undefined): void {
  const method = req.method ?? 'GET';
  if (path === '/api/qa-roles') {
    if (method === 'GET') return void sendJson(res, 200, { roles: roles.list() });
    res.setHeader('Allow', 'GET');
    return void sendJson(res, 405, { error: tr('método não permitido') });
  }
  const match = /^\/api\/qa-roles\/([^/]+)$/.exec(path);
  if (!match) return void sendJson(res, 404, { error: tr('rota desconhecida') });
  if (method !== 'PUT' && method !== 'DELETE') {
    res.setHeader('Allow', 'PUT, DELETE');
    return void sendJson(res, 405, { error: tr('método não permitido') });
  }
  let id: string;
  try { id = decodeURIComponent(match[1]); }
  catch { return void sendJson(res, 400, { error: tr('ID de agente inválido') }); }
  const existing = agent(id);
  if (!existing || existing.kind !== 'main' || (existing.provider !== 'codex' && existing.provider !== 'antigravity')) {
    return void sendJson(res, 400, { error: tr('agente QA não encontrado no escritório') });
  }
  if (method === 'DELETE') {
    try { sendJson(res, 200, { removed: roles.remove(id) }); }
    catch (error) { sendRoleError(res, error); }
    return;
  }
  readJson(req).then((body) => {
    const input = body as { role?: unknown };
    sendJson(res, 200, { assignment: roles.assign(id, input?.role) });
  }).catch((error) => sendRoleError(res, error));
}

function sendRoleError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) return void sendJson(res, error.status, { error: error.message });
  if (error instanceof QaRoleError) return void sendJson(res, error.code === 'corrupt' ? 409 : 400, { error: error.message });
  sendJson(res, 500, { error: tr('erro interno') });
}
