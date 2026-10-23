import { geminiDemoReply, geminiDemoChunks } from './gemini-preview-model';

type Message = {
  role: 'user' | 'assistant';
  text: string;
};

type Session = {
  id: string;
  name: string;
  messages: Message[];
  busy: boolean;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function mountGeminiPreview(root: HTMLElement): void {
  const sessions: Session[] = [];
  let selected = '';
  let sequence = 0;

  const style = el('style');
  style.textContent = `
    .gemini-ui {
      display: grid;
      gap: 14px;
      padding: 14px 0;
      min-width: 0;
      color: inherit;
    }
    .gemini-ui__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .gemini-ui__heading {
      display: grid;
      gap: 4px;
    }
    .gemini-ui__heading strong {
      font-size: 1.08rem;
    }
    .gemini-ui__muted {
      font-size: .82rem;
      opacity: .72;
    }
    .gemini-ui__badge {
      font-size: .75rem;
      padding: 5px 10px;
      border-radius: 999px;
      border: 1px solid currentColor;
      opacity: .78;
    }
    .gemini-ui__toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .gemini-ui__select {
      flex: 1 1 160px;
      min-width: 0;
      padding: 10px;
      border: 1px solid rgba(128,128,128,.5);
      border-radius: 9px;
      background: transparent;
      color: inherit;
    }
    .gemini-ui__history {
      height: min(45vh, 400px);
      min-height: 220px;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      border: 1px solid rgba(128,128,128,.3);
      border-radius: 12px;
    }
    .gemini-ui__message {
      max-width: 90%;
      padding: 12px;
      border-radius: 12px;
      border: 1px solid rgba(128,128,128,.25);
      overflow-wrap: anywhere;
    }
    .gemini-ui__message--user {
      align-self: flex-end;
      background: rgba(80,120,210,.16);
    }
    .gemini-ui__message--assistant {
      align-self: flex-start;
      background: rgba(128,128,128,.1);
    }
    .gemini-ui__message strong {
      display: block;
      margin-bottom: 7px;
      font-size: .8rem;
    }
    .gemini-ui__message pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: inherit;
      line-height: 1.5;
    }
    .gemini-ui__form {
      display: flex;
      gap: 9px;
    }
    .gemini-ui__input {
      flex: 1;
      min-width: 0;
      resize: vertical;
      border: 1px solid rgba(128,128,128,.5);
      border-radius: 9px;
      background: transparent;
      color: inherit;
      padding: 11px;
      font: inherit;
    }
    @media(max-width:540px) {
      .gemini-ui__form { flex-direction: column; }
      .gemini-ui__history { min-height: 180px; }
      .gemini-ui__message { max-width: 96%; }
    }
  `;

  const container = el('section', 'gemini-ui');
  container.setAttribute('aria-label', 'Conversa Gemini');

  const heading = el('div', 'gemini-ui__heading');
  heading.append(
    el('strong', '', 'Gemini · Antigravity'),
    el('span', 'gemini-ui__muted', 'Conversa e streaming de mensagens')
  );

  const header = el('div', 'gemini-ui__header');
  header.append(
    heading,
    el('span', 'gemini-ui__badge', 'Demonstração · 0 tokens')
  );

  const toolbar = el('div', 'gemini-ui__toolbar');
  const selector = el('select', 'gemini-ui__select');
  selector.setAttribute('aria-label', 'Sessão Gemini');

  const create = el('button', 'ui-btn', '+ Nova sessão');
  create.type = 'button';

  const clear = el('button', 'ui-btn', 'Limpar');
  clear.type = 'button';

  toolbar.append(selector, create, clear);

  const history = el('div', 'gemini-ui__history');
  history.setAttribute('role', 'log');
  history.setAttribute('aria-label', 'Histórico Gemini');

  const status = el('p', 'gemini-ui__muted');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const form = el('form', 'gemini-ui__form');
  const input = el('textarea', 'gemini-ui__input');
  input.rows = 3;
  input.maxLength = 2000;
  input.placeholder = 'Escreva uma mensagem...';
  input.setAttribute('aria-label', 'Mensagem ao Gemini');

  const send = el('button', 'ui-btn ui-btn--primary', 'Enviar');
  send.type = 'submit';

  form.append(input, send);

  container.append(
    style, header, toolbar, history, status, form,
    el(
      'p',
      'gemini-ui__muted',
      'Modo simulado: sem acesso ao CLI, ferramentas ou modelos externos.'
    )
  );

  root.append(container);

  const current = () => sessions.find(s => s.id === selected);

  const render = () => {
    selector.replaceChildren();

    for (const session of sessions) {
      const option = el('option');
      option.value = session.id;
      option.textContent =
        session.name + (session.busy ? ' · Respondendo' : '');
      selector.append(option);
    }

    selector.value = selected;

    const session = current();
    const busy = session?.busy ?? false;

    send.disabled = busy;
    input.disabled = busy;
    clear.disabled = busy;

    status.textContent = busy
      ? 'Gemini simulado está respondendo...'
      : 'Pronto · Sem consumo de tokens';

    history.replaceChildren();

    if (!session?.messages.length) {
      history.append(
        el('p', 'gemini-ui__muted', 'Conversa vazia. Envie uma mensagem.')
      );
      return;
    }

    for (const message of session.messages) {
      const card = el(
        'article',
        'gemini-ui__message gemini-ui__message--' + message.role
      );

      card.append(
        el('strong', '', message.role === 'user' ? 'Você' : 'Gemini · Simulado'),
        el('pre', '', message.text || 'Gerando resposta...')
      );

      history.append(card);
    }

    history.scrollTop = history.scrollHeight;
  };

  const newSession = () => {
    sequence++;

    const session: Session = {
      id: `gemini-demo-${sequence}`,
      name: `Conversa ${sequence}`,
      messages: [],
      busy: false,
    };

    sessions.push(session);
    selected = session.id;
    input.value = '';
    render();
  };

  create.onclick = () => {
    newSession();
    input.focus();
  };

  selector.onchange = () => {
    selected = selector.value;
    render();
  };

  clear.onclick = () => {
    const session = current();

    if (!session || session.busy) return;

    session.messages = [];
    render();
  };

  form.onsubmit = event => {
    event.preventDefault();

    const session = current();
    const text = input.value.trim();

    if (!session || session.busy || !text) return;

    session.messages.push({ role: 'user', text });

    const answer: Message = {
      role: 'assistant',
      text: '',
    };

    session.messages.push(answer);
    session.busy = true;

    input.value = '';

    const chunks = geminiDemoChunks(geminiDemoReply(text), 12);
    let index = 0;

    render();

    const timer = setInterval(() => {
      if (index < chunks.length) {
        answer.text += chunks[index++];
      }

      if (index >= chunks.length) {
        clearInterval(timer);
        session.busy = false;
      }

      render();
    }, 40);
  };

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  newSession();
}
