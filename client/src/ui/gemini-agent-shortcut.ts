/**
 * Integra o perfil visual do personagem Gemini ao chat nativo.
 *
 * Não inicia processos, não executa agy e não consome tokens.
 * Observa apenas a interface e reutiliza o painel de conversação.
 */

export function isGeminiProfile(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();

  return (
    normalized.includes('Agente') &&
    normalized.includes('Gemini') &&
    normalized.includes('Antigravity CLI') &&
    normalized.includes('Agora') &&
    normalized.includes('Vida social') &&
    !normalized.includes('Escritório')
  );
}

function findGeminiActions(): HTMLElement | undefined {
  const buttons = document.querySelectorAll('button');

  for (const button of buttons) {
    const name = button.textContent?.trim() ?? '';

    if (name !== 'Seguir' && name !== 'Centralizar') {
      continue;
    }

    let ancestor: HTMLElement | null = button.parentElement;

    for (let depth = 0; ancestor && depth < 9; depth++) {
      if (isGeminiProfile(ancestor.textContent ?? '')) {
        return button.parentElement ?? undefined;
      }

      ancestor = ancestor.parentElement;
    }
  }

  return undefined;
}

export function installGeminiAgentShortcut(
  openGemini: () => void
): () => void {
  const button = document.createElement('button');

  button.type = 'button';
  button.className = 'ui-btn';
  button.textContent = 'Conversar com Gemini';
  button.dataset.geminiAgentChat = 'true';
  button.setAttribute('aria-label', 'Abrir conversa com Gemini');

  button.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'gap:6px',
    'border-radius:8px',
    'padding:8px 11px',
    'font-weight:600',
    'cursor:pointer',
    'max-width:100%',
    'white-space:normal',
  ].join(';');

  button.onclick = () => {
    openGemini();
  };

  let disposed = false;
  let pending = false;

  const synchronize = () => {
    pending = false;

    if (disposed) return;

    const actions = findGeminiActions();

    if (!actions) {
      button.remove();
      return;
    }

    if (button.parentElement !== actions) {
      actions.append(button);
    }
  };

  const observer = new MutationObserver(() => {
    if (pending || disposed) return;

    pending = true;
    queueMicrotask(synchronize);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  synchronize();

  return () => {
    disposed = true;
    observer.disconnect();
    button.remove();
  };
}
