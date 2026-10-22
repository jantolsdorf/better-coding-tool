// Auto-coding: checking the choices from the dialog, coding, and telling the user what happened.

import { applyAutoCode, previewAutoCode, type AutoCodeOptions } from '../model/autoCode';
import { splitCodePath } from '../model/codes';
import { notify, toast } from '../view/feedback';

/** Codes all passages found with the options; returns whether anything was coded (so the dialog can close). */
export function runAutoCode(docIds: string[], opts: AutoCodeOptions, codePath: string, color: string): boolean {
  if (!opts.phrases.length) return (notify('Enter at least one word or phrase to look for.', 'Nothing to look for'), false);
  if (!splitCodePath(codePath).length) return (notify('Choose the code to apply (an existing code, or a new name).', 'Code missing'), false);
  if (!docIds.length) return (notify('Choose at least one document.', 'No document chosen'), false);
  if (opts.scope === 'paragraph' && opts.paragraphBreak === 'custom' && !opts.separators.length) {
    return (notify('Enter at least one separator, or choose another way to find paragraphs.', 'Separator missing'), false);
  }
  const preview = previewAutoCode(docIds, opts);
  if (!preview.passages.length) return (notify('None of the words or phrases occur in the chosen documents.', 'Nothing found'), false);
  const res = applyAutoCode(docIds, opts, codePath, color);
  const total = res.added + res.extended;
  const name = splitCodePath(codePath).join(' > ');
  toast(
    total
      ? `Auto-coded ${total} passage${total === 1 ? '' : 's'} in ${preview.docs} document${preview.docs === 1 ? '' : 's'} with “${name}”${res.extended ? ` (${res.extended} extended an existing segment)` : ''}. Undo reverts it.`
      : `All passages already had “${name}”.`,
    6000,
  );
  return true;
}
