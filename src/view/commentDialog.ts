// A small dialog for writing a comment about a passage, e.g. why you challenge a code.

import { h } from './dom';

export type CommentResult = { action: 'save'; text: string } | { action: 'remove' } | undefined;

/**
 * Asks for a comment. Resolves with the text, with 'remove' (only offered for an existing
 * comment), or undefined if cancelled. Enter saves, Shift+Enter adds a line, Esc cancels.
 */
export function askComment(opts: { title: string; context: string; quote: string; initial?: string; saveLabel?: string; removeLabel?: string }): Promise<CommentResult> {
  return new Promise((resolve) => {
    let result: CommentResult;
    const dlg = h('dialog', { class: 'modal comment-dialog' });
    const area = h('textarea', { class: 'field', rows: 4, placeholder: 'Why do you not agree with this code?' });
    area.value = opts.initial ?? '';
    const close = () => dlg.close();
    const save = () => {
      if (!area.value.trim()) return area.focus();
      result = { action: 'save', text: area.value.trim() };
      close();
    };
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        save();
      }
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.append(
      h(
        'div',
        { class: 'modal-inner' },
        h(
          'div',
          { class: 'modal-head' },
          h('strong', { class: 'grow' }, opts.title),
          opts.initial && opts.removeLabel
            ? h('button', { class: 'btn danger', onClick: () => ((result = { action: 'remove' }), close()) }, opts.removeLabel)
            : null,
          h('button', { class: 'btn', onClick: close }, 'Cancel'),
          h('button', { class: 'btn primary', onClick: save }, opts.saveLabel ?? 'Save'),
        ),
        h(
          'div',
          { class: 'modal-body' },
          h('div', { class: 'comment-context muted' }, opts.context),
          h('blockquote', { class: 'comment-quote' }, opts.quote),
          area,
          h('div', { class: 'muted comment-hint' }, 'Enter saves · Shift+Enter for a new line · Esc cancels'),
        ),
      ),
    );
    document.body.append(dlg);
    dlg.showModal();
    area.focus();
  });
}
