// Messages and questions to the user. Controllers use these instead of calling the browser's
// dialogs directly, so all user interaction goes through the view layer.

import { h } from './dom';

/** A short message that disappears by itself. */
export function toast(message: string, ms = 3500) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts' });
    document.body.append(host);
  }
  const t = h('div', { class: 'toast' }, message);
  host.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** A message the user has to acknowledge. */
export const notify = (message: string) => window.alert(message);

/** A yes/no question (OK = yes). */
export const confirmAction = (question: string) => window.confirm(question);

/** A question with a text answer; null when cancelled. */
export const ask = (question: string, suggestion?: string) => window.prompt(question, suggestion);
