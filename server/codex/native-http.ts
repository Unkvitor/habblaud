import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson, HttpError } from '../http/app';
import type { ManagedCodex } from './managed';
import { maskSecrets } from '../../shared/activity';
import { tr } from '../../shared/i18n';

// Called only after the existing Host/Origin/JSON guard, on the local listener.
export function nativeRoutes(codex: ManagedCodex, names: () => Array<{ sessionId?: string; name: string; id: string }>, hubStatus?: () => unknown) {
  return (req: IncomingMessage, res: ServerResponse, url: URL): boolean => {
    if (!url.pathname.startsWith('/api/native-codex')) return false;
    const address = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '')) { sendJson(res, 403, {}); return true; }
    const action = async () => {
      const path = url.pathname.slice('/api/native-codex'.length);
      if (req.method === 'GET' && path === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const update = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
        codex.on('update', update);
        update({ method: 'connection/open' }); // browser always rehydrates authoritative history on reconnect
        const ping = setInterval(() => res.write(': keepalive\n\n'), 15_000);
        res.on('close', () => { clearInterval(ping); codex.off('update', update); });
        return;
      }
      if (req.method === 'GET' && path === '/threads') {
        const page = await codex.list(url.searchParams.get('cursor') ?? undefined);
        const agents = names();
        for (const t of page.data) {
          const agent = agents.find(a => a.sessionId === t.id);
          if (agent) { t.name = agent.name; t.agentId = agent.id; }
        }
        return sendJson(res, 200, page);
      }
      if (req.method === 'GET' && path === '/history') return sendJson(res, 200, await codex.history(url.searchParams.get('thread') ?? '', url.searchParams.get('cursor') ?? undefined));
      if (req.method === 'GET' && path === '/approvals') return sendJson(res, 200, { data: codex.approvals() });
      if (req.method === 'GET' && path === '/hub') {
        if (hubStatus) return sendJson(res, 200, hubStatus());
        try {
          const response = await fetch('http://127.0.0.1:4748/api/status', { signal: AbortSignal.timeout(2500) });
          if (!response.ok) throw new Error('hub');
          const data = await response.json() as any;
          return sendJson(res, 200, { online: true, antigravity: JSON.parse(maskSecrets(JSON.stringify(data.antigravity ?? { sessions: [] }))) });
        } catch { return sendJson(res, 200, { online: false, antigravity: { sessions: [] } }); }
      }
      if (req.method === 'POST') {
        const body = await readJson(req) as any;
        if (path === '/create') return sendJson(res, 201, await codex.create());
        if (path === '/send') { await codex.send(body.threadId, body.text); return sendJson(res, 202, { ok: true }); }
        if (path === '/decision') { codex.decide(body.identity, body.decision); return sendJson(res, 200, { ok: true }); }
      }
      sendJson(res, 404, { error: tr('Rota desconhecida.') });
    };
    void action().catch(e => {
      if (res.headersSent) return res.destroy();
      sendJson(res, e instanceof HttpError ? e.status : 409, { error: maskSecrets(e instanceof Error ? e.message : tr('Falha no App Server.')) });
    });
    return true;
  };
}