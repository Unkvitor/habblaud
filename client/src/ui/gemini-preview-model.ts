export function geminiDemoReply(input: string): string {
  const message = input.trim();

  if (!message) {
    throw new Error('Mensagem vazia.');
  }

  const normalized = message.toLocaleLowerCase('pt-BR');

  if (normalized.includes('qa') || normalized.includes('teste')) {
    return [
      'Gemini · Demonstração QA',
      '',
      'Recebi sua solicitação de QA.',
      'O histórico e o streaming estão funcionando em modo simulado.',
      'Nenhum teste externo ou modelo de IA foi executado.',
    ].join('\n');
  }

  if (normalized.includes('automação') || normalized.includes('status')) {
    return [
      'Gemini · Demonstração',
      '',
      'A interface está preparada para acompanhar automações.',
      'Ainda não foram consultadas pipelines ou sessões reais.',
      'Nenhum token foi consumido nesta resposta.',
    ].join('\n');
  }

  return [
    'Gemini · Demonstração',
    '',
    `Mensagem recebida: ${message.slice(0, 400)}`,
    '',
    'Esta é uma resposta de demonstração.',
    'A conexão real com Antigravity ainda está desabilitada.',
  ].join('\n');
}

export function geminiDemoChunks(text: string, size = 8): string[] {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError('Tamanho de fragmento inválido.');
  }

  const chunks: string[] = [];

  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }

  return chunks;
}
