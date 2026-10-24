import { describe, expect, it } from 'vitest';
import { shouldFollowGeminiScroll } from './gemini-scroll';

describe('Rolagem automática Gemini', () => {
  it('acompanha a resposta quando está no final', () => {
    expect(shouldFollowGeminiScroll(1000, 600, 400))
      .toBe(true);
  });

  it('aceita pequena distância do final', () => {
    expect(shouldFollowGeminiScroll(1000, 520, 400))
      .toBe(true);
  });

  it('não força a rolagem enquanto o usuário lê o histórico', () => {
    expect(shouldFollowGeminiScroll(2000, 200, 500))
      .toBe(false);
  });

  it('funciona em conversas menores que a tela', () => {
    expect(shouldFollowGeminiScroll(300, 0, 600))
      .toBe(true);
  });
});
