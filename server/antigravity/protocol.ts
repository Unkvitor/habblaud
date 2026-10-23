/**
 * Parser incremental de NDJSON.
 *
 * Responsável exclusivamente pelo enquadramento e pela
 * validação sintática das mensagens JSON.
 *
 * Não interpreta comandos, permissões ou eventos do Gemini.
 */
export class NdjsonParser {
  private buffer = '';
  private readonly maxLineLength: number;

  constructor(maxLineLength = 1024 * 1024) {
    if (!Number.isSafeInteger(maxLineLength) || maxLineLength < 1) {
      throw new RangeError('Limite de linha inválido.');
    }

    this.maxLineLength = maxLineLength;
  }

  push(chunk: string): unknown[] {
    if (typeof chunk !== 'string') {
      throw new TypeError('O fragmento deve ser uma string.');
    }

    const combined = this.buffer + chunk;
    const lines = combined.split('\n');
    const remainder = lines.pop() ?? '';

    for (const line of lines) {
      if (line.length > this.maxLineLength) {
        throw new Error('Linha NDJSON excede o limite permitido.');
      }
    }

    if (remainder.length > this.maxLineLength) {
      throw new Error('Linha NDJSON excede o limite permitido.');
    }

    const messages: unknown[] = [];

    for (const line of lines) {
      const content = line.endsWith('\r')
        ? line.slice(0, -1)
        : line;

      if (!content.trim()) continue;

      messages.push(JSON.parse(content));
    }

    this.buffer = remainder;

    return messages;
  }

  reset(): void {
    this.buffer = '';
  }

  finish(): unknown[] {
    if (!this.buffer.trim()) {
      this.buffer = '';
      return [];
    }

    const pending = this.buffer;
    this.buffer = '';

    if (pending.length > this.maxLineLength) {
      throw new Error('Linha NDJSON excede o limite permitido.');
    }

    return [JSON.parse(pending)];
  }
}
