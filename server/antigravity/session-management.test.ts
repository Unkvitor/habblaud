import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedAntigravity } from './managed';

describe('Gerenciamento de sessões Gemini', () => {
  it('renomeia uma sessão sem perder o histórico', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gemini-manage-'));

    try {
      const storeFile = join(root, 'sessions.json');
      const manager = new ManagedAntigravity({
        workspace: root,
        storeFile,
        launch: async () => ({ text: 'Resposta Gemini' }),
      });

      const session = manager.create();

      await manager.send(session.id, 'Olá');

      const renamed = manager.rename(session.id, 'Meu projeto');

      expect(renamed.title).toBe('Meu projeto');
      expect(manager.history(session.id)).toHaveLength(2);

      const restored = new ManagedAntigravity({
        workspace: root,
        storeFile,
      });

      expect(restored.list()[0].title).toBe('Meu projeto');
      expect(restored.history(session.id)).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exclui a sessão e remove o histórico persistido', () => {
    const root = mkdtempSync(join(tmpdir(), 'gemini-delete-'));

    try {
      const storeFile = join(root, 'sessions.json');
      const manager = new ManagedAntigravity({
        workspace: root,
        storeFile,
      });

      const session = manager.create();

      manager.remove(session.id);

      expect(manager.list()).toHaveLength(0);
      expect(() => manager.history(session.id)).toThrow();

      const restored = new ManagedAntigravity({
        workspace: root,
        storeFile,
      });

      expect(restored.list()).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('impede renomear ou excluir enquanto o Gemini trabalha', async () => {
    let finish!: (value: { text: string }) => void;

    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
      launch: () => new Promise(resolve => {
        finish = resolve;
      }),
    });

    const session = manager.create();
    const pending = manager.send(session.id, 'Executar');

    expect(() => manager.rename(session.id, 'Outro nome'))
      .toThrow('Sessão ocupada');

    expect(() => manager.remove(session.id))
      .toThrow('Sessão ocupada');

    finish({ text: 'Concluído' });
    await pending;

    expect(manager.list()[0].status).toBe('idle');
  });

  it('rejeita nomes inválidos', () => {
    const manager = new ManagedAntigravity({
      workspace: process.cwd(),
    });

    const session = manager.create();

    expect(() => manager.rename(session.id, '  '))
      .toThrow('Nome da conversa inválido');

    expect(() => manager.rename(session.id, 'a'.repeat(81)))
      .toThrow('Nome da conversa inválido');
  });
});
