import { describe, expect, it } from 'vitest';
import { isGeminiProfile } from './gemini-agent-shortcut';

describe('Atalho de conversa Gemini', () => {
  it('reconhece o perfil Gemini do QA Hub', () => {
    expect(isGeminiProfile(
      'Agente Gemini Antigravity CLI · Gemini Agora Vida social'
    )).toBe(true);
  });

  it('não aparece para agentes Codex', () => {
    expect(isGeminiProfile(
      'Agente Marcelo Codex Agora Vida social'
    )).toBe(false);
  });

  it('não confunde outros agentes com o Gemini', () => {
    expect(isGeminiProfile(
      'Agente Henrique Antigravity CLI Agora Vida social'
    )).toBe(false);
  });

  it('não identifica a lista geral de agentes', () => {
    expect(isGeminiProfile(
      'Escritório Marcelo Henrique Gemini Antigravity CLI'
    )).toBe(false);
  });
});
