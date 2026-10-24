/**
 * Verifica se o usuário está próximo do final da conversa.
 *
 * scrollHeight: altura total do conteúdo
 * scrollTop: posição atual
 * clientHeight: altura visível
 */
export function shouldFollowGeminiScroll(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 100
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
