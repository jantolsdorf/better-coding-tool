// First-use dialog asking for the coder's name.

import { setCoderName } from '../controller/preferences';
import { h } from './dom';

/**
 * Asks for the coder's name before anything else, because it labels this person's coding
 * when projects are exported, shared and compared. It cannot be dismissed without a name.
 */
export function askCoderName(onDone?: () => void) {
  const input = h('input', {
    type: 'text',
    class: 'field',
    placeholder: 'e.g. Jan',
    autocomplete: 'name',
    spellcheck: 'false',
  });
  const start = h('button', { class: 'btn primary', disabled: true }, 'Start coding');
  const dlg = h(
    'dialog',
    { class: 'modal welcome' },
    h(
      'form',
      {
        class: 'modal-inner',
        method: 'dialog',
        onSubmit: (e: Event) => {
          e.preventDefault();
          if (!setCoderName(input.value)) return;
          dlg.close();
          onDone?.();
        },
      },
      h('div', { class: 'modal-head' }, h('strong', {}, 'Welcome to Better Coding Tool')),
      h(
        'div',
        { class: 'modal-body' },
        h(
          'p',
          { class: 'muted' },
          'What is your name? It labels your coding when you export your project and when others compare their coding with yours. You can change it later at the top.',
        ),
        h('label', { class: 'label' }, 'Your name'),
        input,
      ),
      h('div', { class: 'modal-foot' }, h('span', { class: 'grow' }), start),
    ),
  );
  input.addEventListener('input', () => (start.disabled = !input.value.trim()));
  // Escape would otherwise close the dialog without a name.
  dlg.addEventListener('cancel', (e) => e.preventDefault());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  input.focus();
}
