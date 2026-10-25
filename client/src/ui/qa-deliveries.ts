import type { QaDelivery, QaDeliveryEventType, QaDeliveryStatus, QaTask } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import { h } from './dom';

const STATUS_LABEL: Record<QaDeliveryStatus, string> = {
  draft: tr('Rascunho'), in_review: tr('Em revisão'), approved: tr('Aprovada'), returned: tr('Devolvida para ajustes'),
};
export const DELIVERY_EVENT_LABEL: Record<QaDeliveryEventType, string> = {
  delivery_recorded: tr('Entrega registrada'), delivery_review_requested: tr('Revisão solicitada'),
  delivery_approved: tr('Entrega aprovada'), delivery_returned: tr('Entrega devolvida'),
};
const WORKING = new Set(['assigned', 'in_progress', 'awaiting_approval']);

/** Limites validados pelo servidor (server/tasks/deliveries.ts); repetidos aqui só para avisar antes de enviar. */
export const CLIENT_LIMITS = { summary: 2_000, evidenceItems: 20, evidenceLength: 500, justification: 2_000 } as const;
/** Identidade que o servidor grava nas decisões da interface local: localhost não autentica uma pessoa. */
const LOCAL_UI_ACTOR = 'human:local-ui';

export type DeliveryStage = 'none' | 'can_record' | 'draft' | 'in_review';

/** Próxima etapa possível de uma subtarefa. Tarefas sem tarefa principal (e anteriores ao P2.6) não têm fluxo de entrega. */
export function deliveryStage(task: QaTask): DeliveryStage {
  if (!task.parentId || !WORKING.has(task.status)) return 'none';
  const latest = task.deliveries?.[task.deliveries.length - 1];
  if (latest?.status === 'draft') return 'draft';
  if (latest?.status === 'in_review') return 'in_review';
  return latest?.status === 'approved' ? 'none' : 'can_record';
}

/** Uma referência de evidência por linha; linhas em branco são ignoradas. */
export function parseEvidence(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Mensagem de validação (ou undefined) antes de registrar uma entrega: evita enviar o que o servidor recusaria. */
export function recordProblem(summary: string, evidence: string[]): string | undefined {
  const text = summary.trim();
  if (!text) return tr('Informe o resumo da entrega.');
  if (text.length > CLIENT_LIMITS.summary) return tr('O resumo da entrega pode ter até {0} caracteres.', [CLIENT_LIMITS.summary]);
  if (new Set(evidence).size > CLIENT_LIMITS.evidenceItems) return tr('Informe no máximo {0} referências de evidência.', [CLIENT_LIMITS.evidenceItems]);
  if (evidence.some((ref) => ref.length > CLIENT_LIMITS.evidenceLength)) return tr('Cada referência de evidência pode ter até {0} caracteres.', [CLIENT_LIMITS.evidenceLength]);
  return undefined;
}

export function decisionProblem(justification: string): string | undefined {
  const text = justification.trim();
  if (!text) return tr('Informe a justificativa da decisão.');
  if (text.length > CLIENT_LIMITS.justification) return tr('A justificativa pode ter até {0} caracteres.', [CLIENT_LIMITS.justification]);
  return undefined;
}

/** Quem agiu, sem fingir autenticação: decisões da interface local aparecem como tal, não como o revisor. */
export function actorLabel(actorId: string, name: (agentId: string) => string): string {
  return actorId === LOCAL_UI_ACTOR ? tr('interface local (sem autenticação)') : name(actorId);
}

export interface DeliveryActions {
  /** Cada ação resolve `true` só quando o servidor aceitou: só então os rascunhos dos campos são descartados. */
  record(taskId: string, summary: string, evidence: string[]): Promise<boolean>;
  requestReview(taskId: string, deliveryId: string, reviewerId: string): Promise<boolean>;
  decide(taskId: string, deliveryId: string, action: 'approve' | 'return', justification: string): Promise<boolean>;
}
export interface DeliveryView {
  /** Agentes presentes com o papel persistente de investigador e revisor, exceto o responsável da tarefa. */
  reviewers: Array<{ id: string; name: string }>;
  name(agentId: string): string;
  /** Rascunhos de campos por chave: sobrevivem às re-renderizações do painel. */
  drafts: Map<string, string>;
  /** Mostra uma mensagem de validação ou de falha na área de estado do painel. */
  notify(message: string): void;
  actions: DeliveryActions;
}

/** Campo com rascunho: o texto e o foco (via `data-draft`, restaurado pelo painel) sobrevivem às re-renderizações. */
function field<T extends HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>(view: DeliveryView, key: string, el: T): T {
  const saved = view.drafts.get(key);
  if (saved !== undefined) el.value = saved;
  el.setAttribute('data-draft', key);
  el.addEventListener(el instanceof HTMLSelectElement ? 'change' : 'input', () => view.drafts.set(key, el.value));
  return el;
}

function describe(delivery: QaDelivery, view: DeliveryView): HTMLElement {
  return h('li', { class: `qa-tasks__delivery is-${delivery.status}` },
    h('p', { text: `${STATUS_LABEL[delivery.status]} · ${new Date(delivery.createdAt).toLocaleString()}` }),
    h('p', { text: delivery.summary }),
    delivery.evidence.length ? h('ul', {}, ...delivery.evidence.map((ref) => h('li', { text: ref }))) : null,
    delivery.reviewerId ? h('p', { text: `${tr('Revisor')}: ${view.name(delivery.reviewerId)}` }) : null,
    delivery.justification ? h('p', { text: `${tr('Justificativa')}: ${delivery.justification}` }) : null,
    delivery.decidedBy ? h('p', { text: `${tr('Decisão registrada por')}: ${actorLabel(delivery.decidedBy, view.name)}` }) : null,
    h('details', {}, h('summary', { text: tr('Histórico ({0})', [delivery.history.length]) }),
      h('ol', {}, ...delivery.history.map((entry) => h('li', { text: `${new Date(entry.at).toLocaleString()} · ${DELIVERY_EVENT_LABEL[entry.type]}${entry.type === 'delivery_review_requested' && entry.note ? ` → ${view.name(entry.note)}` : ''} · ${actorLabel(entry.actorId, view.name)}` })))));
}

/** Entregas de uma subtarefa. Só registra e decide: nunca envia mensagem nem executa agentes. */
export function renderDeliveries(task: QaTask, view: DeliveryView): HTMLElement | null {
  if (!task.parentId) return null;
  const stage = deliveryStage(task);
  const deliveries = task.deliveries ?? [];
  if (!deliveries.length && stage === 'none') return null;
  const root = h('div', { class: 'qa-tasks__deliveries' }, h('strong', { text: tr('Entregas') }));
  if (deliveries.length) root.append(h('ol', { class: 'qa-tasks__list' }, ...deliveries.map((delivery) => describe(delivery, view))));
  const latest = deliveries[deliveries.length - 1];
  const reviewerChoice = (): HTMLSelectElement | undefined => {
    const reviewers = view.reviewers.filter((reviewer) => reviewer.id !== task.assigneeId && reviewer.id !== latest?.reviewerId);
    if (!reviewers.length) return undefined;
    const select = field(view, `${task.id}:reviewer`, h('select', { attrs: { 'aria-label': tr('Revisor') } }, ...reviewers.map((reviewer) => h('option', { text: reviewer.name, attrs: { value: reviewer.id } }))));
    // Um rascunho de revisor que saiu da lista não pode ficar selecionado por engano.
    if (!reviewers.some((reviewer) => reviewer.id === select.value)) { select.selectedIndex = 0; view.drafts.delete(`${task.id}:reviewer`); }
    return select;
  };
  const sendReview = (select: HTMLSelectElement): void => {
    void view.actions.requestReview(task.id, latest!.id, select.value).then((ok) => { if (ok) view.drafts.delete(`${task.id}:reviewer`); });
  };
  if (stage === 'can_record') {
    const summary = field(view, `${task.id}:summary`, h('textarea', { attrs: { rows: 2, maxlength: CLIENT_LIMITS.summary, placeholder: tr('Resumo da entrega'), 'aria-label': tr('Resumo da entrega') } }));
    const evidence = field(view, `${task.id}:evidence`, h('textarea', { attrs: { rows: 2, placeholder: tr('Referências de evidência, uma por linha'), 'aria-label': tr('Referências de evidência') } }));
    root.append(h('form', { class: 'qa-tasks__form', on: { submit: (event: Event) => {
      event.preventDefault();
      const refs = parseEvidence(evidence.value);
      const problem = recordProblem(summary.value, refs);
      if (problem) return view.notify(problem);
      void view.actions.record(task.id, summary.value, refs).then((ok) => { if (ok) { view.drafts.delete(`${task.id}:summary`); view.drafts.delete(`${task.id}:evidence`); } });
    } } }, summary, evidence, h('button', { class: 'ui-btn ui-btn--sm', type: 'submit', text: tr('Registrar entrega') })));
  } else if (stage === 'draft' && latest) {
    const select = reviewerChoice();
    if (!select) root.append(h('p', { class: 'native-hint', text: tr('Nenhum agente presente com o papel Investigador e revisor.') }));
    else root.append(h('div', { class: 'qa-tasks__actions' }, select, h('button', { class: 'ui-btn ui-btn--sm', text: tr('Enviar para revisão'), on: { click: () => sendReview(select) } })));
  } else if (stage === 'in_review' && latest) {
    const present = !!latest.reviewerId && view.reviewers.some((reviewer) => reviewer.id === latest.reviewerId);
    if (!present) {
      // O revisor vinculado saiu ou perdeu o papel: o servidor recusa a decisão, então a entrega precisa de outro revisor.
      const select = reviewerChoice();
      root.append(h('p', { class: 'native-hint', text: tr('O revisor vinculado não está mais presente com o papel Investigador e revisor.') }));
      if (select) root.append(h('div', { class: 'qa-tasks__actions' }, select, h('button', { class: 'ui-btn ui-btn--sm', text: tr('Reencaminhar para outro revisor'), on: { click: () => sendReview(select) } })));
      else root.append(h('p', { class: 'native-hint', text: tr('Nenhum agente presente com o papel Investigador e revisor.') }));
    } else {
      const justification = field(view, `${latest.id}:justification`, h('textarea', { attrs: { rows: 2, maxlength: CLIENT_LIMITS.justification, placeholder: tr('Justificativa da decisão'), 'aria-label': tr('Justificativa da decisão') } }));
      const decide = (action: 'approve' | 'return') => {
        const problem = decisionProblem(justification.value);
        if (problem) return view.notify(problem);
        void view.actions.decide(task.id, latest.id, action, justification.value).then((ok) => { if (ok) view.drafts.delete(`${latest.id}:justification`); });
      };
      root.append(h('div', { class: 'qa-tasks__form' }, justification, h('div', { class: 'qa-tasks__actions' },
        h('button', { class: 'ui-btn ui-btn--sm', text: tr('Aprovar entrega'), on: { click: () => decide('approve') } }),
        h('button', { class: 'ui-btn ui-btn--sm', text: tr('Devolver para ajustes'), on: { click: () => decide('return') } }))));
    }
  }
  return root;
}
