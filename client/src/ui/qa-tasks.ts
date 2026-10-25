import type { QaTask, TaskStatus } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import type { UiContext } from './context';
import { h } from './dom';

const NEXT: Record<TaskStatus, TaskStatus[]> = {
  pending: ['assigned', 'blocked'], assigned: ['in_progress', 'blocked', 'awaiting_approval', 'completed'],
  in_progress: ['blocked', 'awaiting_approval', 'completed'], blocked: ['assigned'],
  awaiting_approval: ['assigned', 'blocked', 'completed'], completed: [],
};
const LABEL: Record<TaskStatus, string> = {
  pending: tr('Pendente'), assigned: tr('Atribuída'), in_progress: tr('Em execução'), blocked: tr('Bloqueada'),
  awaiting_approval: tr('Aguardando aprovação humana'), completed: tr('Concluída'),
};
export function allowedQaTransitions(status: TaskStatus): readonly TaskStatus[] { return NEXT[status]; }

async function request(path: string, init?: RequestInit): Promise<{ tasks?: QaTask[]; task?: QaTask }> {
  const response = await fetch(path, { cache: 'no-store', ...init });
  const data = await response.json() as { error?: string; tasks?: QaTask[]; task?: QaTask };
  if (!response.ok) throw new Error(data.error ?? tr('Falha ao atualizar tarefas.'));
  return data;
}

/** Painel manual: registra intenção humana, sem enviar mensagens nem iniciar qualquer agente. */
export class QaTasksPanel {
  readonly button: HTMLButtonElement;
  readonly el: HTMLElement;
  private readonly status: HTMLElement;
  private readonly list: HTMLElement;
  private readonly description: HTMLTextAreaElement;
  private readonly assignee: HTMLSelectElement;
  private open = false;
  private loading = false;

  constructor(private readonly ctx: UiContext) {
    this.button = h('button', { class: 'ui-btn', text: tr('Tarefas QA'), attrs: { 'aria-expanded': 'false' }, on: { click: () => this.toggle() } });
    const close = h('button', { class: 'ui-btn', text: tr('Fechar'), on: { click: () => this.toggle(false) } });
    this.status = h('p', { attrs: { role: 'status', 'aria-live': 'polite' } });
    this.description = h('textarea', { attrs: { rows: 3, maxlength: 2000, placeholder: tr('Descreva a tarefa de QA') } });
    this.assignee = h('select', { attrs: { 'aria-label': tr('Responsável') } });
    const create = h('button', { class: 'ui-btn ui-btn--primary', type: 'submit', text: tr('Criar tarefa') });
    const form = h('form', { class: 'qa-tasks__form', on: { submit: (event: Event) => { event.preventDefault(); void this.create(); } } }, this.description, this.assignee, create);
    this.list = h('ol', { class: 'qa-tasks__list' });
    this.el = h('section', { class: 'ui-panel qa-tasks', hidden: true, attrs: { 'aria-label': tr('Gestão de tarefas QA') } }, h('header', {}, h('strong', { text: tr('Tarefas QA') }), close), h('p', { class: 'native-hint', text: tr('Ações manuais não enviam prompts nem executam agentes.') }), form, this.status, this.list);
    ctx.store.on('snapshot', () => { if (this.open) void this.load(); });
  }

  private toggle(open = !this.open): void {
    this.open = open; this.el.hidden = !open; this.button.setAttribute('aria-expanded', String(open));
    if (open) void this.load();
  }
  private agents(): void {
    const agents = (this.ctx.store.snapshot?.agents ?? []).filter((agent) => agent.kind === 'main' && (agent.provider === 'codex' || agent.provider === 'antigravity'));
    const selected = this.assignee.value;
    this.assignee.replaceChildren(...agents.map((agent) => h('option', { text: `${agent.name} · ${agent.provider === 'codex' ? 'Codex' : 'Gemini'}`, attrs: { value: agent.id } })));
    if (agents.some((agent) => agent.id === selected)) this.assignee.value = selected;
  }
  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.agents();
    try { this.render((await request('/api/qa-tasks')).tasks ?? []); this.status.textContent = ''; }
    catch (error) { this.status.textContent = error instanceof Error ? error.message : tr('Falha ao carregar tarefas.'); }
    finally { this.loading = false; }
  }
  private render(tasks: QaTask[]): void {
    this.list.replaceChildren(...tasks.map((task) => {
      const title = h('strong', { text: task.description });
      const state = h('p', { text: LABEL[task.status] + (task.status === 'awaiting_approval' ? ` · ${tr('requer decisão humana')}` : '') });
      const history = h('details', {}, h('summary', { text: tr('Histórico ({0})', [task.events.length]) }), h('ol', {}, ...task.events.map((event) => h('li', { text: `${new Date(event.at).toLocaleString()} · ${event.from ? `${LABEL[event.from]} → ` : ''}${LABEL[event.to]}` }))));
      const actions = h('div', { class: 'qa-tasks__actions' }, ...allowedQaTransitions(task.status).map((next) => h('button', { class: 'ui-btn ui-btn--sm', text: LABEL[next], on: { click: () => void this.transition(task.id, next) } })));
      const delegation = task.delegation ? h('p', { text: `${tr('Delegação')}: ${task.delegation.status === 'proposed' ? tr('aguardando aprovação humana') : task.delegation.status === 'approved' ? tr('aprovada para execução futura') : tr('rejeitada')}` }) : null;
      if (task.delegation?.status === 'proposed') actions.append(h('button', { class: 'ui-btn ui-btn--sm', text: tr('Aprovar delegação'), on: { click: () => void this.decision(task.id, 'approve') } }), h('button', { class: 'ui-btn ui-btn--sm', text: tr('Rejeitar delegação'), on: { click: () => void this.decision(task.id, 'reject') } }));
      return h('li', { class: `qa-tasks__item is-${task.status}` }, title, state, delegation, actions, history);
    }));
    if (!tasks.length) this.list.append(h('li', { text: tr('Nenhuma tarefa interna registrada.') }));
  }
  private async create(): Promise<void> {
    if (!this.description.value.trim() || !this.assignee.value) return;
    try {
      await request('/api/qa-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: this.description.value, assigneeId: this.assignee.value }) });
      this.description.value = ''; await this.load();
    } catch (error) { this.status.textContent = error instanceof Error ? error.message : tr('Falha ao criar tarefa.'); }
  }
  private async transition(id: string, status: TaskStatus): Promise<void> {
    try { await request(`/api/qa-tasks/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); await this.load(); }
    catch (error) { this.status.textContent = error instanceof Error ? error.message : tr('Falha ao atualizar tarefa.'); }
  }
  private async decision(id: string, action: 'approve' | 'reject'): Promise<void> {
    try { await request(`/api/qa-tasks/${encodeURIComponent(id)}/delegation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, decidedBy: 'human' }) }); await this.load(); }
    catch (error) { this.status.textContent = error instanceof Error ? error.message : tr('Falha ao decidir delegação.'); }
  }
}
