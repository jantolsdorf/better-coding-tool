// Messages and questions to the user. Controllers use these instead of calling the browser's
// dialogs directly, so all user interaction goes through the view layer.

import { h } from './dom';
import { currentDocument, currentWindow } from './windows';

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

/** A message the user has to acknowledge. */
export const notify = (message: string) => currentWindow().alert(message);

/** A yes/no question (OK = yes). */
export const confirmAction = (question: string) => currentWindow().confirm(question);

/** A question with a text answer; null when cancelled. */
export const ask = (question: string, suggestion?: string) => currentWindow().prompt(question, suggestion);

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
