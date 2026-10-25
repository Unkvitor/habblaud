import type { QaDelivery, QaDeliveryEventType, QaDeliveryStatus } from '../../shared/types';

/** Limites e validação das entregas de QA (P2.6). Sem I/O: o QaTaskStore é o único dono da persistência. */
export const MAX_DELIVERIES_PER_TASK = 20;
export const MAX_SUMMARY = 2_000;
export const MAX_EVIDENCE_ITEMS = 20;
export const MAX_EVIDENCE_LENGTH = 500;
export const MAX_JUSTIFICATION = 2_000;

export const DELIVERY_EVENT_TYPES: readonly QaDeliveryEventType[] = ['delivery_recorded', 'delivery_review_requested', 'delivery_approved', 'delivery_returned'];
const DELIVERY_STATUSES: ReadonlySet<string> = new Set<QaDeliveryStatus>(['draft', 'in_review', 'approved', 'returned']);

export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

/** Referências de evidência: textos curtos (caminho, URL, ID de execução). Rejeita o conjunto inteiro se algum item for inválido. */
export function cleanEvidence(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_ITEMS) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const text = cleanText(item, MAX_EVIDENCE_LENGTH);
    if (!text) return undefined;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

export function copyDelivery(delivery: QaDelivery): QaDelivery {
  return { ...delivery, evidence: [...delivery.evidence], history: delivery.history.map((entry) => ({ ...entry })) };
}

/** Estrutura persistida: rejeita qualquer estado incoerente em vez de aceitá-lo silenciosamente. */
export function validDelivery(value: unknown): value is QaDelivery {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<QaDelivery>;
  if (typeof d.id !== 'string' || !d.id || typeof d.submittedBy !== 'string' || !d.submittedBy) return false;
  if (!cleanText(d.summary, MAX_SUMMARY) || cleanEvidence(d.evidence) === undefined || !Array.isArray(d.evidence)) return false;
  if (typeof d.status !== 'string' || !DELIVERY_STATUSES.has(d.status)) return false;
  if (typeof d.createdAt !== 'number' || typeof d.updatedAt !== 'number') return false;
  if (!Array.isArray(d.history) || !d.history.length || !d.history.every((e) => e && typeof e.id === 'string' && typeof e.at === 'number' &&
    typeof e.actorId === 'string' && !!e.actorId && DELIVERY_EVENT_TYPES.includes(e.type) && (e.note === undefined || typeof e.note === 'string'))) return false;
  if (d.reviewerId !== undefined && (typeof d.reviewerId !== 'string' || !d.reviewerId)) return false;
  const decided = d.status === 'approved' || d.status === 'returned';
  if (d.status !== 'draft' && !d.reviewerId) return false;
  if (decided && (!cleanText(d.justification, MAX_JUSTIFICATION) || typeof d.decidedBy !== 'string' || !d.decidedBy || typeof d.reviewedAt !== 'number')) return false;
  if (!decided && (d.justification !== undefined || d.decidedBy !== undefined || d.reviewedAt !== undefined)) return false;
  return true;
}
