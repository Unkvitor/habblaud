import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  ManagedAntigravity,
  type AntigravityLauncher,
} from './managed';

const PREFIX = '/api/native-gemini';
const MAX_BODY = 40 * 1024;

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  if (res.headersSent || res.destroyed) return;

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? '';

  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new Error('Content-Type deve ser application/json.');
  }

  let data = '';
  let bytes = 0;

  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);

    bytes += part.length;

    if (bytes > MAX_BODY) {
      throw new Error('Corpo da requisição excede o limite.');
    }

    data += part.toString('utf8');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error('JSON inválido.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw new Error('Objeto JSON obrigatório.');
  }

  return parsed;
}

function field(
  body: unknown,
  name: string,
  required = true
): string | undefined {
  const value = (body as Record<string, unknown>)[name];

  if (!required && value === undefined) return undefined;

  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 32000
  ) {
    throw new Error(`Campo ${name} inválido.`);
  }

  return value;
}

function isLoopback(address?: string): boolean {
  return address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1';
}

function authorized(req: IncomingMessage): boolean {
  if (!isLoopback(req.socket.remoteAddress)) return false;

  const host = req.headers.host;
  if (!host) return false;

  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');

  if (
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1' &&
    hostname !== '[::1]' &&
    hostname !== '::1'
  ) {
    return false;
  }

  const origin = req.headers.origin;

  if (origin) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }

  // Bloqueia POSTs cross-site sem Origin e sem cabeçalho de cliente.
  if (req.method === 'POST' && !origin) {
    return req.headers['x-habblaud-client'] === 'gemini-preview';
  }

  return true;
}

export function createDemoAntigravityLauncher(): AntigravityLauncher {
  return async (_session, text, onChunk) => {
    const response = [
      'Gemini · Demonstração do servidor',
      '',
      `Mensagem recebida: ${text.slice(0, 300)}`,
      '',
      'Esta resposta foi gerada localmente pelo Habblaud.',
      'Nenhum comando Antigravity foi executado.',
      'Nenhum token de IA foi consumido.',
    ].join('\n');

    for (let index = 0; index < response.length; index += 12) {
      onChunk?.(response.slice(index, index + 12));
    }
  };
}

export function createGeminiHttp(
  manager: ManagedAntigravity,
  mode: 'demo' | 'real' = 'demo'
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    if (!req.url) return false;

    let url: URL;

    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return false;
    }

    if (
      url.pathname !== PREFIX &&
      !url.pathname.startsWith(PREFIX + '/')
    ) {
      return false;
    }

    if (!authorized(req)) {
      sendJson(res, 403, { error: 'Acesso não autorizado.' });
      return true;
    }

    const path = url.pathname.slice(PREFIX.length);

    if (path === '/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      });

      let closed = false;

      const publish = (event: unknown) => {
        if (!closed && !res.destroyed) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        manager.off('update', publish);
        clearInterval(heartbeat);
      };

      manager.on('update', publish);

      const heartbeat = setInterval(() => {
        if (!closed && !res.destroyed) res.write(': keepalive\n\n');
      }, 25000);

      res.once('close', cleanup);

      publish({ method: 'connection/open' });

      return true;
    }

    try {
      if (path === '/mode' && req.method === 'GET') {
        sendJson(res, 200, {
          mode,
          simulated: mode === 'demo',
          consumesTokens: mode === 'real',
        });
        return true;
      }

      if (path === '/sessions' && req.method === 'GET') {
        sendJson(res, 200, { data: manager.list() });
        return true;
      }

      if (path === '/history' && req.method === 'GET') {
        const id = url.searchParams.get('id');

        if (!id) throw new Error('Sessão obrigatória.');

        sendJson(res, 200, { data: manager.history(id) });
        return true;
      }

      if (path === '/create' && req.method === 'POST') {
        const body = await readBody(req);
        const cwd = field(body, 'cwd', false);
        const session = manager.create(cwd);
        sendJson(res, 201, session);
        return true;
      }

      if (path === '/send' && req.method === 'POST') {
        const body = await readBody(req);
        const id = field(body, 'id')!;
        const text = field(body, 'text')!;

        await manager.send(id, text);
        sendJson(res, 200, { ok: true });
        return true;
      }


      if (path === '/rename' && req.method === 'POST') {
        const body = await readBody(req);
        const session = manager.rename(
          field(body, 'id')!,
          field(body, 'title')!
        );
        sendJson(res, 200, { data: session });
        return true;
      }

      if (path === '/delete' && req.method === 'POST') {
        const body = await readBody(req);
        manager.remove(field(body, 'id')!);
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (path === '/cancel' && req.method === 'POST') {
        const body = await readBody(req);
        manager.cancel(field(body, 'id')!);
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (path === '/recover' && req.method === 'POST') {
        const body = await readBody(req);
        manager.recover(field(body, 'id')!);
        sendJson(res, 200, { ok: true });
        return true;
      }

      sendJson(res, 404, { error: 'Rota inexistente.' });
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro inesperado.';

      const status = /inexistente/.test(message) ? 404
        : /processamento|ocupada|Limite de sessões/.test(message) ? 409
        : 400;

      sendJson(res, status, { error: message });
      return true;
    }
  };
}
