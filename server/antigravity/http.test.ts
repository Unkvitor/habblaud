import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { ManagedAntigravity, type AntigravityLauncher } from './managed';
import {
  createDemoAntigravityLauncher,
  createGeminiHttp,
} from './http';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(
    server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    })
  ));
});

async function setup(launch:AntigravityLauncher=createDemoAntigravityLauncher()) {
  const manager = new ManagedAntigravity({
    workspace: process.cwd(),
    launch,
  });

  const handler = createGeminiHttp(manager);

  const server = createServer((req, res) => {
    void handler(req, res).then(handled => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    }).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });

  servers.push(server);

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  const post = (path: string, body: unknown) =>
    fetch(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Habblaud-Client': 'gemini-preview',
      },
      body: JSON.stringify(body),
    });

  return { manager, base, post };
}

describe('API Gemini isolada', () => {
  it('cria sessão e consulta histórico', async () => {
    const { base, post } = await setup();

    const created = await post('/api/native-gemini/create', {});
    expect(created.status).toBe(201);

    const session = await created.json() as { id: string };

    const response = await fetch(
      `${base}/api/native-gemini/history?id=${session.id}`
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });

  it('envia mensagem simulada e armazena resposta', async () => {
    const { base, post } = await setup();
    const created = await post('/api/native-gemini/create', {});
    const session = await created.json() as { id: string };

    const sent = await post('/api/native-gemini/send', {
      id: session.id,
      text: 'Olá Gemini',
    });

    expect(sent.status).toBe(200);

    const history = await fetch(
      `${base}/api/native-gemini/history?id=${session.id}`
    );

    const result = await history.json() as {
      data: Array<{ role: string; text: string }>;
    };

    expect(result.data).toHaveLength(2);
    expect(result.data[0].role).toBe('user');
    expect(result.data[1].role).toBe('assistant');
    expect(result.data[1].text).toContain('Nenhum token');
  });

  it('não permite mensagens sem sessão', async () => {
    const { post } = await setup();

    const result = await post('/api/native-gemini/send', {
      id: 'inexistente',
      text: 'Olá',
    });

    expect(result.status).toBe(404);
  });

  it('rejeita requisições de outra origem', async () => {
    const { base } = await setup();

    const response = await fetch(base + '/api/native-gemini/sessions', {
      headers: { Origin: 'https://site-externo.example' },
    });

    expect(response.status).toBe(403);
  });

  it('não interfere com outras rotas', async () => {
    const { base } = await setup();

    const response = await fetch(base + '/api/native-codex/threads');

    expect(response.status).toBe(404);
  });
  it('cancels only a managed turn through the guarded route',async()=>{
    let started!:()=>void;
    const ready=new Promise<void>(resolve=>{started=resolve;});
    const {manager,post}=await setup((_session,_text,onChunk,_meta,signal)=>{
      onChunk?.('partial');started();
      return new Promise((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
    });
    const created=await post('/api/native-gemini/create',{});
    const session=await created.json() as {id:string};
    const pending=post('/api/native-gemini/send',{id:session.id,text:'short'});
    await ready;
    const cancelled=await post('/api/native-gemini/cancel',{id:session.id});
    expect(cancelled.status).toBe(200);
    expect((await pending).status).toBe(409);
    expect(manager.history(session.id).at(-1)).toMatchObject({text:'partial',complete:false});
  });

});
