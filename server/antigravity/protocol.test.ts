import { describe, expect, it } from 'vitest';
import { NdjsonParser } from './protocol';

describe('NdjsonParser', () => {
  it('reconstrói mensagens recebidas em fragmentos', () => {
    const parser = new NdjsonParser();

    expect(parser.push('{"type":"mes')).toEqual([]);
    expect(parser.push('sage","text":"olá"}\n')).toEqual([
      { type: 'message', text: 'olá' },
    ]);
  });

  it('processa várias mensagens no mesmo fragmento', () => {
    const parser = new NdjsonParser();

    expect(parser.push('{"id":1}\n{"id":2}\n')).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it('rejeita JSON inválido', () => {
    const parser = new NdjsonParser();

    expect(() => parser.push('{inválido}\n')).toThrow();
  });

  it('não aceita linhas ilimitadas', () => {
    const parser = new NdjsonParser(128);

    expect(() => parser.push('x'.repeat(129))).toThrow();
  });
});
