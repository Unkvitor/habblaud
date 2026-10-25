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

interface SimulatedExecution { id: string; taskId: string; executorId: string; planHash: string; mode?: 'simulated'|'real'; scope?: string; authorizationKind?: 'simulated'|'human'; state: string; checkpoint?: string; result?: string; error?: string; events: Array<{ at: number; type: string; detail?: string }>; }
type TaskResponse = { tasks?: QaTask[]; task?: QaTask };
type ExecutionResponse = { executions?: SimulatedExecution[]; execution?: SimulatedExecution; realAvailable?: boolean };
type QaRoleId = 'coordinator' | 'automation_engineer' | 'investigator_reviewer';
interface RoleAssignment { agentId: string; role: QaRoleId; updatedAt: number }
type RoleResponse = { roles?: RoleAssignment[]; assignment?: RoleAssignment; removed?: boolean };
const ROLE_LABELS: Record<QaRoleId, string> = {
  coordinator: tr('Coordenador de QA'),
  automation_engineer: tr('Engenheiro de automação'),
  investigator_reviewer: tr('Investigador e revisor'),
};
async function request<T extends TaskResponse | ExecutionResponse | RoleResponse = TaskResponse>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init });
  const data = await response.json() as T & { error?: string };
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
  private readonly parent: HTMLSelectElement;
  private readonly dependencies: HTMLSelectElement;
  private readonly roleAgent: HTMLSelectElement;
  private readonly roleChoice: HTMLSelectElement;
  private readonly rolesList: HTMLElement;
  private roles: RoleAssignment[] = [];
  private open = false;
  private loading = false;

  constructor(private readonly ctx: UiContext) {
    this.button = h('button', { class: 'ui-btn', text: tr('Tarefas QA'), attrs: { 'aria-expanded': 'false' }, on: { click: () => this.toggle() } });
    const close = h('button', { class: 'ui-btn', text: tr('Fechar'), on: { click: () => this.toggle(false) } });
    this.status = h('p', { attrs: { role: 'status', 'aria-live': 'polite' } });
    this.description = h('textarea', { attrs: { rows: 3, maxlength: 2000, placeholder: tr('Descreva a tarefa de QA') } });
    this.assignee = h('select', { attrs: { 'aria-label': tr('Responsável') } });
    this.parent = h('select', { attrs: { 'aria-label': tr('Tarefa principal') } }, h('option', { text: tr('Sem tarefa principal'), attrs: { value: '' } }));
    this.dependencies = h('select', { attrs: { 'aria-label': tr('Dependências',), multiple: 'multiple', size: 3 } });
    const create = h('button', { class: 'ui-btn ui-btn--primary', type: 'submit', text: tr('Criar tarefa') });
    const form = h('form', { class: 'qa-tasks__form', on: { submit: (event: Event) => { event.preventDefault(); void this.create(); } } }, this.description, this.assignee, this.parent, this.dependencies, create);
    this.roleAgent = h('select', { attrs: { 'aria-label': tr('Agente para atribuir função') }, on: { change: () => this.syncRoleChoice() } });
    this.roleChoice = h('select', { attrs: { 'aria-label': tr('Função de QA') } },
      h('option', { text: tr('Sem função definida'), attrs: { value: '' } }),
      ...Object.entries(ROLE_LABELS).map(([value, label]) => h('option', { text: label, attrs: { value } })));
    this.rolesList = h('ul', { class: 'qa-tasks__list' });
    const roleForm = h('form', { class: 'qa-tasks__form', on: { submit: (event: Event) => { event.preventDefault(); void this.saveRole(); } } },
      h('strong', { text: tr('Funções da equipe QA') }),
      h('p', { class: 'native-hint', text: tr('Funções são descritivas: não concedem permissões nem iniciam agentes.') }),
      this.roleAgent, this.roleChoice,
      h('button', { class: 'ui-btn', type: 'submit', text: tr('Salvar função') }));
    this.list = h('ol', { class: 'qa-tasks__list' });
    this.el = h('section', { class: 'ui-panel qa-tasks', hidden: true, attrs: { 'aria-label': tr('Gestão de tarefas QA') } }, h('header', {}, h('strong', { text: tr('Tarefas QA') }), close), h('p', { class: 'native-hint', text: tr('Ações manuais não enviam prompts nem executam agentes.') }), form, roleForm, this.rolesList, this.status, this.list);
    ctx.store.on('snapshot', () => { if (this.open) void this.load(); });
  }

  private toggle(open = !this.open): void {
    this.open = open; this.el.hidden = !open; this.button.setAttribute('aria-expanded', String(open));
    if (open) void this.load();
  }
  private agents(): void {
    const agents = (this.ctx.store.snapshot?.agents ?? []).filter((agent) => agent.kind === 'main' && (agent.provider === 'codex' || agent.provider === 'antigravity'));
    const selected = this.assignee.value;
    const selectedRoleAgent = this.roleAgent.value;
    this.assignee.replaceChildren(...agents.map((agent) => h('option', { text: `${agent.name} · ${agent.provider === 'codex' ? 'Codex' : 'Gemini'}`, attrs: { value: agent.id } })));
    this.roleAgent.replaceChildren(...agents.map((agent) => h('option', { text: agent.name, attrs: { value: agent.id } })));
    if (agents.some((agent) => agent.id === selected)) this.assignee.value = selected;
    if (agents.some((agent) => agent.id === selectedRoleAgent)) this.roleAgent.value = selectedRoleAgent;
    this.syncRoleChoice();
  }
  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try { const roleData = await request<RoleResponse>('/api/qa-roles'); this.roles = roleData.roles ?? []; this.agents(); this.renderRoles(); const tasks=(await request('/api/qa-tasks')).tasks ?? []; this.taskChoices(tasks); const executionData=await request<ExecutionResponse>('/api/qa-executions'); this.render(tasks, executionData.executions ?? [], !!executionData.realAvailable); this.status.textContent = ''; }
    catch (error) { this.status.textContent = error instanceof Error ? error.message : tr('Falha ao carregar tarefas.'); }
    finally { this.loading = false; }
  }
  private syncRoleChoice(): void {
    this.roleChoice.value = this.roles.find((r) => r.agentId === this.roleAgent.value)?.role ?? '';
  }
  private renderRoles(): void {
    const agents = this.ctx.store.snapshot?.agents ?? [];
    this.rolesList.replaceChildren(...this.roles.map((assignment) => {
      const found = agents.find((agent) => agent.id === assignment.agentId);
      return h('li', { text: `${found?.name ?? assignment.agentId} · ${ROLE_LABELS[assignment.role]}` });
    }));
    if (!this.roles.length) this.rolesList.append(h('li', { text: tr('Nenhuma função de QA atribuída.') }));
  }
  private async saveRole(): Promise<void> {
    const agentId = this.roleAgent.value;
    if (!agentId) return;
    const role = this.roleChoice.value;
    try {
      await request<RoleResponse>(`/api/qa-roles/${encodeURIComponent(agentId)}`, role ?
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) } :
        { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
      await this.load();
    } catch (error) { this.status.textContent = error instanceof Error ? error.message : tr('Falha ao salvar função de QA.'); }
  }
  private taskChoices(tasks: QaTask[]): void { const parent=this.parent.value; const deps=[...this.dependencies.selectedOptions].map(x=>x.value); this.parent.replaceChildren(h('option',{text:tr('Sem tarefa principal'),attrs:{value:''}}),...tasks.map(t=>h('option',{text:t.description,attrs:{value:t.id}}))); this.dependencies.replaceChildren(...tasks.map(t=>h('option',{text:t.description,attrs:{value:t.id}}))); this.parent.value=parent; for(const o of this.dependencies.options)o.selected=deps.includes(o.value); }
  private render(tasks: QaTask[], executions: SimulatedExecution[] = [], realAvailable = false): void {
    this.list.replaceChildren(...tasks.map((task) => {
      const title = h('strong', { text: task.description });
      const state = h('p', { text: LABEL[task.status] + (task.status === 'awaiting_approval' ? ` · ${tr('requer decisão humana')}` : '') });
      const history = h('details', {}, h('summary', { text: tr('Histórico ({0})', [task.events.length]) }), h('ol', {}, ...task.events.map((event) => h('li', { text: `${new Date(event.at).toLocaleString()} · ${event.from ? `${LABEL[event.from]} → ` : ''}${LABEL[event.to]}` }))));
      const actions = h('div', { class: 'qa-tasks__actions' }, ...allowedQaTransitions(task.status).map((next) => h('button', { class: 'ui-btn ui-btn--sm', text: LABEL[next], on: { click: () => void this.transition(task.id, next) } })));
      const relations = task.parentId || task.dependencies?.length ? h('p', { text: `${task.parentId ? `${tr('Tarefa principal')}: ${task.parentId}` : ''}${task.parentId && task.dependencies?.length ? ' \u00b7 ' : ''}${task.dependencies?.length ? `${tr('Dependências')}: ${task.dependencies.join(', ')}` : ''}` }) : null;
      const delegation = task.delegation ? h('p', { text: `${tr('Delegação')}: ${task.delegation.status === 'proposed' ? tr('aguardando aprovação humana') : task.delegation.status === 'approved' ? tr('aprovada para execução futura') : tr('rejeitada')}` }) : null;
      const execution = executions.find((value) => value.taskId === task.id);
      const simulation = execution ? h('div', { class: `qa-tasks__simulation ${execution.mode === 'real' ? 'is-real' : 'is-simulated'}` }, h('p', { text: `${execution.mode === 'real' ? tr('Codex real') : tr('Simulação')}: ${execution.state}${execution.checkpoint ? ` · ${execution.checkpoint}` : ''}${execution.result ? ` · ${execution.result}` : ''}${execution.error ? ` · ${execution.error}` : ''}` }), ...(execution.mode === 'real' ? [h('p', { text: `${tr('Escopo')}: ${execution.scope ?? ''}` }), h('p', { text: tr('Permissões: somente leitura; aprovação sob demanda') })] : []), h('details', {}, h('summary', { text: tr('Histórico ({0})', [execution.events.length]) }), h('ol', {}, ...execution.events.map(event => h('li', { text: `${new Date(event.at).toLocaleString()} · ${event.type}${event.detail ? ` · ${event.detail}` : ''}` })))), ...this.simulationControls(execution)) : h('div', {}, h('button', { class: 'ui-btn ui-btn--sm', text: tr('Criar plano simulado'), on: { click: () => void this.plan(task) } }), ...(realAvailable ? [h('button', { class: 'ui-btn ui-btn--sm', text: tr('Criar plano Codex real'), on: { click: () => void this.plan(task, 'real') } })] : []));
      if (task.delegation?.status === 'proposed') actions.append(h('button', { class: 'ui-btn ui-btn--sm', text: tr('Aprovar delegação'), on: { click: () => void this.decision(task.id, 'approve') } }), h('button', { class: 'ui-btn ui-btn--sm', text: tr('Rejeitar delegação'), on: { click: () => void this.decision(task.id, 'reject') } }));
      return h('li', { class: `qa-tasks__item is-${task.status}` }, title, state, relations, delegation, simulation, actions, history);
    }));
    if (!tasks.length) this.list.append(h('li', { text: tr('Nenhuma tarefa interna registrada.') }));
  }
  private async create(): Promise<void> {
    if (!this.description.value.trim() || !this.assignee.value) return;
    try {
      await request('/api/qa-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: this.description.value, assigneeId: this.assignee.value, parentId: this.parent.value || undefined, dependencies: [...this.dependencies.selectedOptions].map(option => option.value) }) });
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
  private simulationControls(execution: SimulatedExecution): HTMLElement[] {
    const controls: HTMLElement[]=[];
    if(execution.state==='awaiting_authorization') controls.push(h('button',{class:'ui-btn ui-btn--sm',text:tr(execution.mode === 'real' ? 'Autorizar execução real' : 'Autorizar simulação'),on:{click:()=>void this.execution(execution.id,execution.mode === 'real' ? 'authorize-real' : 'authorize',{identity:execution.mode === 'real' ? 'human:local-ui' : 'simulated:local-ui',planHash:execution.planHash})}}));
    if(execution.state==='ready') controls.push(h('button',{class:'ui-btn ui-btn--sm',text:tr(execution.mode === 'real' ? 'Iniciar Codex real' : 'Executar simulação'),on:{click:()=>void this.execution(execution.id,execution.mode === 'real' ? 'execute' : 'simulate',execution.mode === 'real' ? {} : {outcome:'success'})}}));
    if(['awaiting_authorization','ready','running'].includes(execution.state)) controls.push(h('button',{class:'ui-btn ui-btn--sm',text:tr(execution.mode === 'real' ? 'Cancelar execução' : 'Cancelar simulação'),on:{click:()=>void this.execution(execution.id,'cancel',{})}}));
    return controls;
  }
  private async plan(task: QaTask, mode: 'simulated'|'real' = 'simulated'): Promise<void> { try { const agent=this.ctx.store.snapshot?.agents.find(value=>value.id===task.assigneeId); if(mode==='real'&&!agent?.sessionId) throw new Error(tr('A sessão original do agente não está disponível.')); await request('/api/qa-executions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(mode === 'real' ? { mode, taskId:task.id,executorId:task.assigneeId,threadId:agent!.sessionId,idempotencyKey:`ui-real-${task.id}`,planHash:`real-plan-${task.id}`,scope:task.description } : {taskId:task.id,executorId:task.assigneeId,threadId:`simulated:${task.assigneeId}`,idempotencyKey:`ui-${task.id}`,planHash:`simulated-plan-${task.id}`,identity:'simulated:local-ui'})});await this.load();}catch(error){this.status.textContent=error instanceof Error?error.message:tr('Falha ao criar plano.');} }
  private async execution(id:string,action:string,body:unknown):Promise<void>{try{await request(`/api/qa-executions/${encodeURIComponent(id)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await this.load();}catch(error){this.status.textContent=error instanceof Error?error.message:tr('Falha na simulação.');}}
}
