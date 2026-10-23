import { describe, expect, it } from 'vitest';
import { ManagedAntigravity } from './managed';

describe('ManagedAntigravity', () => {
  it('não inicia processos ao ser construído', () => {
    let launches = 0;

    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
      launch: () => {
        launches++;
        throw new Error('Não deveria iniciar processo');
      },
    });

    expect(launches).toBe(0);
    expect(manager.list()).toEqual([]);
  });

  it('rejeita mensagens para sessões inexistentes', async () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
    });

    await expect(
      manager.send('sessao-inexistente', 'Olá')
    ).rejects.toThrow('Sessão inexistente ou encerrada.');
  });

  it('não permite envio real sem launcher', async () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
    });

    const session = manager.create();

    await expect(
      manager.send(session.id, 'Olá Gemini')
    ).rejects.toThrow(
      'Execução real do Antigravity não habilitada.'
    );

    expect(manager.list()[0].status).toBe('idle');
  });

  it('não permite mensagens vazias', async () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
    });

    const session = manager.create();

    await expect(
      manager.send(session.id, '   ')
    ).rejects.toThrow('Mensagem vazia ou longa demais.');
  });

  it('não permite enviar mensagens após encerramento', async () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
    });

    const session = manager.create();
    manager.close(session.id);

    await expect(
      manager.send(session.id, 'Olá')
    ).rejects.toThrow('Sessão inexistente ou encerrada.');
  });

  it('impede dois envios simultâneos para a mesma sessão', async () => {
    let release!: () => void;

    const pending = new Promise<void>(resolve => {
      release = resolve;
    });

    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
      launch: async () => {
        await pending;
      },
    });

    const session = manager.create();
    const first = manager.send(session.id, 'Primeira mensagem');

    try {
      expect(manager.list()[0].status).toBe('working');

      await expect(
        manager.send(session.id, 'Segunda mensagem')
      ).rejects.toThrow(
        'Já existe uma mensagem em processamento.'
      );

      expect(() => manager.close(session.id)).toThrow(
        'Não é possível encerrar uma sessão ocupada.'
      );
    } finally {
      release();
      await first;
    }

    expect(manager.list()[0].status).toBe('idle');
  });
});
