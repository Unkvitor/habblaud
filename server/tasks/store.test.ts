import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { QaTaskError, QaTaskStore } from './store';

describe('QaTaskStore', () => {
  it('persiste a tarefa e sua auditoria sem executar nada ao recarregar', () => {
    const tmp = tempDir();
    try {
      let now = 100;
      const file = join(tmp.dir, 'qa-tasks.json');
      const tasks = new QaTaskStore(file, () => ++now);
      const created = tasks.create({ description: 'Cobrir reconexão SSE', assigneeId: 'codex:marcelo' });
      const assigned = tasks.transition(created.id, 'assigned');
      const working = tasks.transition(created.id, 'in_progress');
      expect(working.events.map((event) => [event.type, event.from, event.to])).toEqual([
        ['created', undefined, 'pending'],
        ['status_changed', 'pending', 'assigned'],
        ['status_changed', 'assigned', 'in_progress'],
      ]);
      expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);

      const restored = new QaTaskStore(file);
      restored.load();
      expect(restored.list()).toEqual([working]);
      expect(assigned.updatedAt).toBeLessThan(working.updatedAt);
    } finally {
      tmp.cleanup();
    }
  });

  it('bloqueia duplicidade aberta e transições inválidas', () => {
    const tasks = new QaTaskStore(null, () => 1);
    const task = tasks.create({ description: '  Revisar falha  ', assigneeId: 'gemini:1' });
    expect(() => tasks.create({ description: 'revisar falha', assigneeId: 'gemini:1' })).toThrow(QaTaskError);
    expect(() => tasks.transition(task.id, 'completed')).toThrow(QaTaskError);
    expect(tasks.transition(task.id, 'assigned').status).toBe('assigned');
  });

  it('preserva o último arquivo íntegro se uma gravação for interrompida e ignora corrupção', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'qa-tasks.json');
      const tasks = new QaTaskStore(file, () => 1);
      const created = tasks.create({ description: 'Fila A', assigneeId: 'codex:marcelo' });
      // Um temporário órfão nunca é promovido: rename atômico mantém o arquivo principal válido.
      writeFileSync(`${file}.999.tmp`, '{interrompido');
      const restored = new QaTaskStore(file);
      restored.load();
      expect(restored.list()).toEqual([created]);
      writeFileSync(file, '{corrompido');
      const corrupt = new QaTaskStore(file);
      corrupt.load();
      expect(corrupt.list()).toEqual([]);
    } finally { tmp.cleanup(); }
  });
});
