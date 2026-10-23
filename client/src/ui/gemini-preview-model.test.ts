import { describe, expect, it } from 'vitest';
import { geminiDemoReply, geminiDemoChunks } from './gemini-preview-model';

describe('Gemini demonstrativo', () => {
  it('responde sem solicitar inferência', () => {
    expect(geminiDemoReply('Olá')).toContain('demonstração');
  });

  it('identifica solicitações de QA', () => {
    expect(geminiDemoReply('Quero testar QA')).toContain('QA');
  });

  it('reconstrói uma resposta dividida em fragmentos', () => {
    const message = 'Resposta progressiva do Gemini';
    expect(geminiDemoChunks(message, 5).join('')).toBe(message);
  });

  it('rejeita mensagens vazias', () => {
    expect(() => geminiDemoReply('  ')).toThrow();
  });

  it('rejeita tamanho de fragmento inválido', () => {
    expect(() => geminiDemoChunks('abc', 0)).toThrow();
  });
});
