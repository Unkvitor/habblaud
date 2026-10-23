import { h } from './dom';
import { tr } from '../../../shared/i18n';

type Item = { id: string; text: string; type?: string; status?: string };
type Thread = { id: string; name: string; managed: boolean; agentId?: string; status?: { type: string } };
export function mergeNativeItems(before: Item[], after: Item[]): Item[] {
  const map = new Map(before.map(i => [i.id, i]));
  for (const item of after) map.set(item.id, item);
  return [...map.values()];
}
async function api(path: string, body?: unknown): Promise<any> {
  const r = await fetch('/api/native-codex' + path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || tr('App Server indisponível.'));
  return data;
}
const STATUS: Record<string, string> = { active: tr('Executando'), idle: tr('Ocioso'), notLoaded: tr('Histórico'), systemError: tr('Erro') };
export async function mountNativeCodex(root: HTMLElement): Promise<void> {
  try { await api('/approvals'); } catch { return; } // opt-in local preview only
  const toggle = h('button', { class: 'ui-btn native-toggle', text: tr('Agentes · Codex / Gemini'), attrs: { 'aria-expanded': 'false' } });
  const panel = h('section', { class: 'ui-panel native-panel', hidden: true, attrs: { 'aria-label': tr('Gerenciamento de agentes') } });
  const close = h('button', { class: 'ui-btn', text: tr('Fechar') });
  const header = h('header', {}, h('strong', { text: tr('Agentes · App Server') }), close);
  const sessions = h('select', { attrs: { 'aria-label': tr('Sessão do Codex') } });
  const moreThreads = h('button', { class: 'ui-btn', text: tr('Mais sessões'), hidden: true });
  const create = h('button', { class: 'ui-btn', text: tr('Nova sessão · somente leitura') });
  const state = h('p', { attrs: { role: 'status', 'aria-live': 'polite' } });
  const hint = h('p', { class: 'native-hint' });
  const older = h('button', { class: 'ui-btn', text: tr('Carregar histórico anterior'), hidden: true });
  const history = h('div', { class: 'native-history', attrs: { 'aria-label': tr('Mensagens e execução') } });
  const approvals = h('div', { attrs: { 'aria-label': tr('Aprovações pendentes') } });
  const input = h('textarea', { attrs: { 'aria-label': tr('Mensagem ao agente'), rows: 3, maxlength: 32000 } });
  const send = h('button', { class: 'ui-btn ui-btn--primary', text: tr('Enviar'), type: 'submit' });
  const form = h('form', {}, input, send);
  const hub = h('div', { class: 'native-hub' });
  panel.append(header, h('div', { class: 'native-toolbar' }, sessions, moreThreads, create), state, hint, older, history, approvals, form, hub);
  root.append(toggle, panel);
  let threads: Thread[] = [], selected = '', items: Item[] = [], cursor: string | null = null, threadCursor: string | null = null;
  let source: EventSource | undefined, polling: ReturnType<typeof setInterval> | undefined;
  let sending = false;
  const refreshing = new Set<string>();
  const current = () => threads.find(t => t.id === selected);
  const report = (e: unknown) => { state.textContent = e instanceof Error ? e.message : tr('Falha na operação.'); };
  const render = () => {
    const nearEnd = history.scrollHeight - history.scrollTop - history.clientHeight < 80;
    const nodes = items.map(i => h('article', { class: 'native-item', attrs: { 'data-item-id': i.id } },
      h('strong', { text: i.type === 'agentMessage' ? 'Codex' : i.type === 'userMessage' ? tr('Você') : tr('Execução') }), h('pre', { text: i.text })));
    history.replaceChildren(...nodes);
    if (nearEnd) history.scrollTop = history.scrollHeight;
  };
  const loadHistory = async (previous = false) => {
    const id = selected; if (!id || refreshing.has(id)) return;
    refreshing.add(id);
    try {
      const page = await api('/history?thread=' + encodeURIComponent(id) + (previous && cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      if (id !== selected) return;
      const data: Item[] = page.data.slice().reverse();
      items = previous ? mergeNativeItems(data, items) : mergeNativeItems(items, data);
      if (previous || cursor === null) cursor = page.nextCursor;
      older.hidden = !cursor; render();
    } finally { refreshing.delete(id); }
  };
  const loadApprovals = async () => {
    const page = await api('/approvals');
    approvals.replaceChildren();
    for (const a of page.data.filter((a: any) => a.threadId === selected)) {
      const row = h('article', { class: 'native-approval' }, h('strong', { text: tr('Aprovação · sessão {0}', [a.threadId.slice(0, 8)]) }), h('pre', { text: JSON.stringify(a.detail, null, 2) }));
      for (const decision of ['accept', 'decline']) {
        // MCP elicitation has a form/URL schema; do not pretend it is a yes/no tool approval.
        if (decision === 'accept' && (a.method === 'mcpServer/elicitation/request' || a.detail.grantRoot)) continue;
        const button = h('button', { class: 'ui-btn', text: decision === 'accept' ? tr('Aprovar uma vez') : tr('Recusar') });
        button.onclick = () => {
          row.querySelectorAll('button').forEach(b => b.disabled = true);
          void api('/decision', { identity: a, decision }).then(loadApprovals).catch(report);
        };
        row.append(button);
      }
      approvals.append(row);
    }
  };
  const loadThreads = async (more = false) => {
    const page = await api('/threads' + (more && threadCursor ? '?cursor=' + encodeURIComponent(threadCursor) : ''));
    threads = more ? [...threads, ...page.data] : page.data;
    threadCursor = page.nextCursor; moreThreads.hidden = !threadCursor;
    sessions.replaceChildren(...threads.map(t => h('option', { text: `${t.name.slice(0, 90)} · ${STATUS[t.status?.type ?? ''] ?? tr('Desconhecido')}`, attrs: { value: t.id } })));
    if (threads.some(t => t.id === selected)) sessions.value = selected;
  };
  const choose = async () => {
    selected = sessions.value; items = []; cursor = null; history.replaceChildren();
    localStorage.setItem('habblaud-native-thread', selected);
    const t = current();
    state.textContent = t ? (STATUS[t.status?.type ?? ''] ?? tr('Desconhecido')) : tr('Nenhuma sessão encontrada.');
    send.disabled = !t || (!t.managed && !t.agentId); input.disabled = send.disabled;
    hint.textContent = t?.managed ? tr('App Server: respostas ao vivo; aprovações individuais. Novas sessões usam somente leitura e revisão humana.') : tr('Sessão existente: envio pela fila original. Aprovações permanecem no terminal de origem; histórico atualizado a cada 4 segundos.');
    await loadHistory(); await loadApprovals(); history.scrollTop = history.scrollHeight;
  };
  const loadHub = async () => {
    const data = await api('/hub');
    hub.replaceChildren(h('strong', { text: tr('Gemini / Antigravity · QA Agent Hub') }));
    if (!data.online) { hub.append(h('p', { text: tr('Hub indisponível; telemetria não confirmada.') })); return; }
    const rows = data.antigravity.sessions;
    if (!rows.length) hub.append(h('p', { text: tr('Nenhum evento de sessão recebido pelo Hub.') }));
    for (const row of rows) hub.append(h('p', { text: `${row.model || 'Antigravity'} · ${row.status} · ${row.event} · ${row.session.slice(0, 12)} · ${row.last_seen}` }));
  };
  const hide = () => {
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); source?.close(); source = undefined;
    if (polling) clearInterval(polling); toggle.focus();
  };
  close.onclick = hide;
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); hide(); } });
  toggle.onclick = () => {
    if (!panel.hidden) return hide();
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    selected = localStorage.getItem('habblaud-native-thread') ?? '';
    void loadThreads().then(choose).then(loadHub).catch(report);
    source = new EventSource('/api/native-codex/events');
    source.onmessage = e => {
      const event = JSON.parse(e.data);
      if (event.method === 'connection/open') { void loadHistory().then(loadApprovals).catch(report); return; }
      if (event.method === 'connection/closed') { state.textContent = tr('App Server desconectado. Reabra o painel para consultar o histórico.'); return; }
      if (event.threadId !== selected) return;
      state.textContent = event.method;
      if (event.method === 'item/agentMessage/delta') {
        items = mergeNativeItems(items, [{ id: event.itemId, type: 'agentMessage', text: event.text }]); render();
      }
      if (event.item) { items = mergeNativeItems(items, [event.item]); render(); }
      if (event.method === 'turn/completed' || event.method === 'serverRequest/resolved') void loadHistory().catch(report);
      if (event.method.endsWith('/requestApproval') || event.method === 'mcpServer/elicitation/request' || event.method === 'serverRequest/resolved') void loadApprovals().catch(report);
    };
    source.onerror = () => { state.textContent = tr('Reconectando; o histórico será recuperado sem reenviar mensagens.'); };
    polling = setInterval(() => {
      if (!current()?.managed) void loadHistory().catch(report);
      void loadApprovals().catch(report); void loadHub().catch(report);
    }, 4000);
  };
  sessions.onchange = () => { void choose().catch(report); };
  moreThreads.onclick = () => { void loadThreads(true).catch(report); };
  older.onclick = () => { void loadHistory(true).catch(report); };
  create.onclick = () => {
    create.disabled = true;
    void api('/create', {}).then(async data => { selected = data.id; await loadThreads(); sessions.value = selected; await choose(); })
      .catch(report).finally(() => { create.disabled = false; });
  };
  form.onsubmit = e => {
    e.preventDefault(); const t = current(); if (sending || !t || !input.value.trim()) return;
    sending = true; send.disabled = true;
    const text = input.value;
    const request = t.managed ? api('/send', { threadId: t.id, text }) : fetch('/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: t.agentId, text }),
    }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; });
    void request.then(() => { if (input.value === text) input.value = ''; state.textContent = t.managed ? tr('Turno enviado ao App Server.') : tr('Envio registrado na fila; aguarde a resposta no histórico.'); })
      .catch(report).finally(() => { sending = false; send.disabled = false; });
  };
}