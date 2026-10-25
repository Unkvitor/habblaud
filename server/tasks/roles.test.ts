import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { QaRoleStore, QaRoleError } from './roles';

describe('QaRoleStore', () => {
  it('preserva as responsabilidades por ID original sem iniciar ou modificar sessões', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'qa-agent-roles.json');
      const store = new QaRoleStore(file, () => 101);
      store.assign('.codex:marcelo-thread', 'coordinator');
      store.assign('.codex:henrique-thread', 'automation_engineer');
      store.assign('antigravity:gemini-session', 'investigator_reviewer');
      const restored = new QaRoleStore(file);
      restored.load();
      expect(restored.list().map((role) => [role.agentId, role.role])).toEqual([
        ['.codex:henrique-thread', 'automation_engineer'],
        ['.codex:marcelo-thread', 'coordinator'],
        ['antigravity:gemini-session', 'investigator_reviewer'],
      ]);
      expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);
    } finally { tmp.cleanup(); }
  });

  it('não aceita papéis desconhecidos nem IDs vazios', () => {
    const store = new QaRoleStore(null);
    expect(() => store.assign('', 'coordinator')).toThrow(QaRoleError);
    expect(() => store.assign('codex:id', 'admin')).toThrow(QaRoleError);
    expect(store.list()).toEqual([]);
  });

  it('recusa gravações se o armazenamento original estiver inválido', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'qa-agent-roles.json');
      writeFileSync(file, '{invalid');
      const store = new QaRoleStore(file);
      store.load();
      expect(() => store.assign('codex:id', 'coordinator')).toThrow(QaRoleError);
      expect(readFileSync(file, 'utf8')).toBe('{invalid');
    } finally { tmp.cleanup(); }
  });

  it('remove somente um vínculo, preservando os demais', () => {
    const store = new QaRoleStore(null);
    store.assign('codex:a', 'coordinator');
    store.assign('codex:b', 'automation_engineer');
    expect(store.remove('codex:a')).toBe(true);
    expect(store.list()).toEqual([{ agentId: 'codex:b', role: 'automation_engineer', updatedAt: expect.any(Number) }]);
    expect(store.remove('codex:a')).toBe(false);
  });

  it('bloqueia arquivo em versão desconhecida para evitar sobrescrita de dados', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'qa-agent-roles.json');
      writeFileSync(file, '{"version":2,"roles":[]}');
      const store = new QaRoleStore(file);
      store.load();
      expect(() => store.assign('codex:id', 'coordinator')).toThrow(QaRoleError);
    } finally { tmp.cleanup(); }
  });
});
