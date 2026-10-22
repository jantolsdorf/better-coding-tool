// Messages and questions to the user, as dialogs of the app (never the browser's own alert,
// confirm or prompt). Controllers use these, so all user interaction goes through the view layer.

import { h } from './dom';
import { currentDocument } from './windows';

/** A short message that disappears by itself. */
export function toast(message: string, ms = 3500) {
  // Shown in the window used last (the app can have parts in separate windows).
  const doc = currentDocument();
  let host = doc.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts' });
    doc.body.append(host);
  }
  const t = h('div', { class: 'toast' }, message);
  host.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

interface DialogButton<T> {
  label: string;
  value: T;
  kind?: 'primary' | 'danger';
}

/**
 * A dialog of the app (instead of the browser's alert/confirm): a title, a message (line breaks
 * kept) and buttons. Esc or clicking outside resolves with `cancel`. The button at `focus` has
 * the focus, so Enter chooses it.
 */
function showDialog<T>(opts: { title: string; message: string; buttons: DialogButton<T>[]; cancel: T; focus: number }): Promise<T> {
  return new Promise((resolve) => {
    let result = opts.cancel;
    const dlg = h('dialog', { class: 'modal message-dialog' });
    const buttons = opts.buttons.map((b) =>
      h(
        'button',
        {
          type: 'button',
          class: 'btn' + (b.kind === 'primary' ? ' primary' : b.kind === 'danger' ? ' danger-solid' : ''),
          onClick: () => {
            result = b.value;
            dlg.close();
          },
        },
        b.label,
      ),
    );
    dlg.append(
      h(
        'div',
        { class: 'modal-inner' },
        h('div', { class: 'modal-head' }, h('strong', {}, opts.title)),
        h('div', { class: 'modal-body' }, h('p', { class: 'message-text' }, opts.message)),
        h('div', { class: 'modal-foot' }, h('span', { class: 'grow' }), ...buttons),
      ),
    );
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    // In the window used last (parts of the app can be in separate windows).
    currentDocument().body.append(dlg);
    dlg.showModal();
    buttons[opts.focus]?.focus();
  });
}

/** A message the user has to acknowledge (e.g. why something could not be done). */
export function notify(message: string, title = 'Please note'): Promise<void> {
  return showDialog({ title, message, buttons: [{ label: 'OK', value: undefined, kind: 'primary' }], cancel: undefined, focus: 0 });
}

interface ConfirmOptions {
  title?: string;
  /** The label of the confirming button, saying what it does (e.g. "Delete", "Merge"). */
  confirm: string;
  cancel?: string;
  /** For actions that remove something: the button is red and Enter means Cancel. */
  danger?: boolean;
}

/** A question to confirm an action; resolves true if confirmed. */
export function confirmAction(question: string, { title = 'Please confirm', confirm, cancel = 'Cancel', danger = false }: ConfirmOptions): Promise<boolean> {
  return showDialog({
    title,
    message: question,
    buttons: [
      { label: cancel, value: false },
      { label: confirm, value: true, kind: danger ? 'danger' : 'primary' },
    ],
    cancel: false,
    focus: danger ? 0 : 1,
  });
}

export interface Choice<T> {
  label: string;
  detail?: string;
  value: T;
  primary?: boolean;
}

interface ChooseOptions<T> {
  title: string;
  message?: string;
  choices: Choice<T>[];
  cancelLabel?: string;
}

/** Shows a modal list of choices. Resolves with the chosen value, or `undefined` if cancelled. */
export function choose<T>({ title, message, choices, cancelLabel = 'Cancel' }: ChooseOptions<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'choose-dialog';

    const heading = document.createElement('h2');
    heading.textContent = title;
    dialog.append(heading);

    if (message) {
      const p = document.createElement('p');
      p.textContent = message;
      dialog.append(p);
    }

    // Wrapped so that a legitimately chosen `null` is distinguishable from "cancelled".
    let picked: { value: T } | undefined;

    const list = document.createElement('div');
    list.className = 'choose-list';
    for (const choice of choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const label = document.createElement('span');
      label.className = 'choose-label';
      label.textContent = choice.label;
      btn.append(label);
      if (choice.detail) {
        const detail = document.createElement('span');
        detail.className = 'choose-detail';
        detail.textContent = choice.detail;
        btn.append(detail);
      }
      if (choice.primary) btn.classList.add('primary');
      btn.addEventListener('click', () => {
        picked = { value: choice.value };
        dialog.close();
      });
      list.append(btn);
    }
    dialog.append(list);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'choose-cancel';
    cancel.textContent = cancelLabel;
    cancel.addEventListener('click', () => dialog.close());
    dialog.append(cancel);

    // Clicking the backdrop cancels.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });

    // Fires for button clicks and for Escape.
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(picked?.value);
    });

    currentDocument().body.append(dialog);
    dialog.showModal();
    (list.querySelector('button') as HTMLButtonElement | null)?.focus();
  });
}

/** Explains that the browser did not open a new window. */
export const popupBlocked = () =>
  toast('The browser blocked the new window. Allow pop-ups for this page (usually an icon in the address bar) and try again.', 7000);

interface AskTextOptions {
  title: string;
  message?: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  okLabel?: string;
}

/**
 * Asks for a short text in a dialog of the app (instead of the browser's prompt). Resolves with the
 * trimmed text, or undefined if cancelled. Enter confirms, Esc cancels; OK needs some text.
 */
export function askText({ title, message, label, initial = '', placeholder = '', okLabel = 'OK' }: AskTextOptions): Promise<string | undefined> {
  return new Promise((resolve) => {
    let result: string | undefined;
    const input = h('input', { type: 'text', class: 'field', value: initial, placeholder, spellcheck: 'false', autocomplete: 'off' });
    const ok = h('button', { type: 'submit', class: 'btn primary' }, okLabel);
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
    const form = h(
      'form',
      { class: 'modal-inner', method: 'dialog' },
      h('div', { class: 'modal-head' }, h('strong', {}, title)),
      h(
        'div',
        { class: 'modal-body' },
        message ? h('p', { class: 'muted' }, message) : null,
        label ? h('label', { class: 'label' }, label) : null,
        input,
      ),
      h('div', { class: 'modal-foot' }, h('span', { class: 'grow' }), cancel, ok),
    );
    const dlg = h('dialog', { class: 'modal ask-text' }, form);
    const update = () => (ok.disabled = !input.value.trim());
    input.addEventListener('input', update);
    update();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      result = input.value.trim();
      dlg.close();
    });
    cancel.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    currentDocument().body.append(dlg);
    dlg.showModal();
    input.focus();
    input.select();
  });
}
