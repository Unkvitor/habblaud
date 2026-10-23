import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedAntigravity } from './managed';

describe('Antigravity - Conversação', () => {
  it('registra mensagens do usuário e do assistente', async () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
      launch: async (_session, _text, onChunk) => {
        onChunk?.('Olá! ');
        onChunk?.('Como posso ajudar?');
      },
    });

    const session = manager.create();
    await manager.send(session.id, 'Olá Gemini');

    const messages = manager.history(session.id);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].text).toBe('Olá Gemini');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].text).toBe('Olá! Como posso ajudar?');
    expect(messages[1].complete).toBe(true);
  });

  it('emite deltas e conclusão da resposta', async () => {
    const events: Array<{ method: string; delta?: string }> = [];

    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
      launch: async (_session, _text, onChunk) => {
        onChunk?.('Primeiro ');
        onChunk?.('fragmento');
      },
    });

    manager.on('update', event => events.push(event));

    const session = manager.create();
    await manager.send(session.id, 'Teste');

    expect(
      events.filter(event => event.method === 'message/delta')
        .map(event => event.delta)
    ).toEqual(['Primeiro ', 'fragmento']);

    expect(
      events.some(event => event.method === 'message/completed')
    ).toBe(true);

    expect(manager.list()[0].status).toBe('idle');
  });

  it('mantém os históricos separados por sessão', async () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
      launch: async (_session, text, onChunk) => {
        onChunk?.(`Resposta: ${text}`);
      },
    });

    const first = manager.create();
    const second = manager.create();

    await manager.send(first.id, 'A');
    await manager.send(second.id, 'B');

    expect(manager.history(first.id)[0].text).toBe('A');
    expect(manager.history(second.id)[0].text).toBe('B');
    expect(manager.history(first.id)[1].text).toBe('Resposta: A');
    expect(manager.history(second.id)[1].text).toBe('Resposta: B');
  });

  it('não permite alterar o histórico pelo retorno público', async () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
      launch: async (_session, _text, onChunk) => {
        onChunk?.('Resposta original');
      },
    });

    const session = manager.create();
    await manager.send(session.id, 'Mensagem');

    const copy = manager.history(session.id);
    copy[1].text = 'Texto adulterado';

    expect(manager.history(session.id)[1].text)
      .toBe('Resposta original');
  });

  it('bloqueia novas mensagens após falha e permite recuperação', async () => {
    let attempts = 0;

    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
      launch: async (_session, _text, onChunk) => {
        attempts++;

        if (attempts === 1) {
          onChunk?.('Resposta parcial');
          throw new Error('Erro simulado');
        }

        onChunk?.('Resposta recuperada');
      },
    });

    const session = manager.create();

    await expect(
      manager.send(session.id, 'Primeira')
    ).rejects.toThrow('Falha no processamento');

    expect(manager.list()[0].status).toBe('error');
    expect(manager.history(session.id)[1].complete).toBe(false);

    await expect(
      manager.send(session.id, 'Segunda')
    ).rejects.toThrow('recuperação necessária');

    manager.recover(session.id);
    await manager.send(session.id, 'Segunda');

    expect(manager.list()[0].status).toBe('idle');
    expect(manager.history(session.id).at(-1)?.text)
      .toBe('Resposta recuperada');
  });

  it('rejeita respostas que ultrapassam o limite', async () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
      launch: async (_session, _text, onChunk) => {
        onChunk?.('x'.repeat(64001));
      },
    });

    const session = manager.create();

    await expect(
      manager.send(session.id, 'Teste')
    ).rejects.toThrow('Falha no processamento');

    expect(manager.list()[0].status).toBe('error');
  });

  it('limita a quantidade de sessões', () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
      maxSessions: 2,
    });

    manager.create();
    manager.create();

    expect(() => manager.create())
      .toThrow('Limite de sessões atingido.');
  });

  it('limita o histórico sem comprometer a sessão', async () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
      maxMessages: 3,
      launch: async (_session, text, onChunk) => {
        onChunk?.(`Eco: ${text}`);
      },
    });

    const session = manager.create();

    await manager.send(session.id, 'Um');
    await manager.send(session.id, 'Dois');
    await manager.send(session.id, 'Três');

    expect(manager.history(session.id)).toHaveLength(3);
    expect(manager.history(session.id).at(-1)?.text)
      .toBe('Eco: Três');
  });

  it('impede acesso a diretórios externos por link simbólico', () => {
    const root = mkdtempSync(join(tmpdir(), 'ag-root-'));
    const external = mkdtempSync(join(tmpdir(), 'ag-outside-'));

    try {
      mkdirSync(join(root, 'safe'));
      symlinkSync(external, join(root, 'escape'));

      const manager = new ManagedAntigravity({
        workspace: root,
      });

      expect(() => manager.create(join(root, 'escape')))
        .toThrow('Sessão fora do workspace permitido.');

      expect(() => manager.create(join(root, 'safe')))
        .not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  it('não registra mensagens quando a execução está desabilitada', async () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
    });

    const session = manager.create();

    await expect(
      manager.send(session.id, 'Não executar')
    ).rejects.toThrow('não habilitada');

    expect(manager.history(session.id)).toEqual([]);
  });
});
