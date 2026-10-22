// The "Auto-code" tab of the + Code dialog: words or phrases to look for, the code to apply,
// whether to code each occurrence or its paragraph (with the paragraph separators), the
// documents, and a live preview of what would be coded.

import { runAutoCode } from '../controller/autoCode';
import { parsePhrases, previewAutoCode, type AutoCodeOptions, type ParagraphBreak } from '../model/autoCode';
import { codePath, codesInTreeOrder, findCodeByPath, nextColor, splitCodePath } from '../model/codes';
import { currentDoc, docsInTreeOrder, folderPath, getDoc } from '../model/documents';
import { lineLabel } from '../model/lines';
import { h } from './dom';

const PREVIEW_ITEMS = 8;

/** A list of all code paths for name fields ("Parent > Child"), to pick existing codes or parents. */
export function codePathOptions(id: string): HTMLDataListElement {
  return h('datalist', { id }, ...codesInTreeOrder().map((c) => h('option', { value: codePath(c) })));
}

export function autoCodeTab(close: () => void): HTMLElement {
  // ---- inputs ----
  const phrases = h('textarea', { class: 'field', rows: 3, placeholder: 'One word or phrase per line, e.g.\nbird is the word\nbi* is the *ord (* = any leading or trailing letters)' });
  const matchCase = h('input', { type: 'checkbox' });
  const wholeWords = h('input', { type: 'checkbox', checked: true });

  const code = h('input', { type: 'text', class: 'field', placeholder: 'code   or   parent code > subcode', list: 'ac-code-paths', spellcheck: 'false', autocomplete: 'off' });
  const color = h('input', { type: 'color', class: 'swatch-input big', value: nextColor(), title: 'Color for a new code' });
  const codeNote = h('span', { class: 'muted ac-code-note' });

  const scopeName = `ac-scope-${Math.random().toString(36).slice(2)}`;
  const radio = (name: string, value: string, checked = false) => h('input', { type: 'radio', name, value, checked });
  const scopeOcc = radio(scopeName, 'occurrence', true);
  const scopePara = radio(scopeName, 'paragraph');
  const breakName = `${scopeName}-break`;
  const breakLine = radio(breakName, 'line', true);
  const breakBlank = radio(breakName, 'blank');
  const breakCustom = radio(breakName, 'custom');
  const separators = h('textarea', { class: 'field', rows: 3, placeholder: 'One separator per line, e.g.\nInterviewer:\nParticipant:' });
  const paragraphOptions = h(
    'div',
    { class: 'ac-paragraph-options' },
    h('span', { class: 'muted' }, 'A paragraph ends at'),
    h('label', {}, breakLine, ' every line break'),
    h('label', {}, breakBlank, ' empty lines'),
    h('label', {}, breakCustom, ' custom separators (a new paragraph starts where one occurs):'),
    separators,
  );

  // ---- documents ----
  const docs = docsInTreeOrder();
  const open = currentDoc();
  const chosen = new Set(open ? [open.id] : docs.map((d) => d.id));
  const allBox = h('input', { type: 'checkbox' });
  const docList = h('div', { class: 'ac-docs' });
  const docLabel = (id: string) => {
    const d = getDoc(id)!;
    const path = folderPath(d.folderId);
    return path ? `${path} / ${d.name}` : d.name;
  };
  const renderDocs = () => {
    allBox.checked = chosen.size === docs.length && docs.length > 0;
    allBox.indeterminate = chosen.size > 0 && chosen.size < docs.length;
    docList.replaceChildren(
      ...docs.map((d) => {
        const box = h('input', { type: 'checkbox', checked: chosen.has(d.id) });
        box.addEventListener('change', () => {
          if (box.checked) chosen.add(d.id);
          else chosen.delete(d.id);
          renderDocs();
          update();
        });
        return h('label', { class: 'ac-doc' }, box, ` ${docLabel(d.id)}`);
      }),
    );
  };
  allBox.addEventListener('change', () => {
    chosen.clear();
    if (allBox.checked) docs.forEach((d) => chosen.add(d.id));
    renderDocs();
    update();
  });

  // ---- preview and applying ----
  const preview = h('div', { class: 'ac-preview' });
  const applyBtn = h('button', { type: 'button', class: 'btn primary' }, 'Auto-code');

  const options = (): AutoCodeOptions => ({
    phrases: parsePhrases(phrases.value),
    matchCase: matchCase.checked,
    wholeWords: wholeWords.checked,
    scope: scopePara.checked ? 'paragraph' : 'occurrence',
    paragraphBreak: (breakBlank.checked ? 'blank' : breakCustom.checked ? 'custom' : 'line') as ParagraphBreak,
    separators: separators.value.split('\n').map((s) => s.trim()).filter(Boolean),
  });

  let timer = 0;
  const update = () => {
    clearTimeout(timer);
    timer = window.setTimeout(renderPreview, 120);
  };
  const renderPreview = () => {
    const opts = options();
    paragraphOptions.hidden = opts.scope !== 'paragraph';
    separators.disabled = !breakCustom.checked;
    const parts = splitCodePath(code.value);
    const existing = parts.length ? findCodeByPath(parts) : undefined;
    color.hidden = !!existing || !parts.length;
    codeNote.textContent = !parts.length ? '' : existing ? 'existing code' : 'new code (created when you auto-code)';
    const needsSeparator = opts.scope === 'paragraph' && opts.paragraphBreak === 'custom' && !opts.separators.length;
    if (!opts.phrases.length || !chosen.size || needsSeparator) {
      const why = !chosen.size
        ? 'Choose at least one document.'
        : needsSeparator
          ? 'Enter at least one separator (or choose another way paragraphs end).'
          : 'Enter words or phrases to see what would be coded.';
      preview.replaceChildren(h('p', { class: 'muted' }, why));
      applyBtn.disabled = true;
      applyBtn.title = applyBtn.disabled ? "Check required settings above before applying auto-coding." : "Apply auto-coding now."
      applyBtn.textContent = 'Apply auto-coding';
      return;
    }
    const res = previewAutoCode([...chosen], opts);
    const n = res.passages.length;
    applyBtn.disabled = !n || !parts.length;
    applyBtn.textContent = n ? `Auto-code ${n} passage${n === 1 ? '' : 's'}` : 'Auto-code';
    const what = opts.scope === 'paragraph' ? `${n} paragraph${n === 1 ? '' : 's'}` : `${n} passage${n === 1 ? '' : 's'}`;
    preview.replaceChildren(
      h(
        'p',
        { class: 'ac-summary' },
        res.matches
          ? `${res.matches} occurrence${res.matches === 1 ? '' : 's'} → ${what} in ${res.docs} of ${chosen.size} document${chosen.size === 1 ? '' : 's'}.`
          : 'No occurrences in the chosen documents.',
      ),
      ...res.passages.slice(0, PREVIEW_ITEMS).map((p) => {
        const doc = getDoc(p.docId)!;
        const text = doc.content.slice(p.start, p.end);
        return h(
          'div',
          { class: 'ac-example' },
          h('span', { class: 'ac-example-where' }, `${doc.name} ${lineLabel(doc, p.start, p.end)}`),
          h('span', { class: 'ac-example-text' }, text.length > 180 ? `${text.slice(0, 180)}…` : text),
        );
      }),
      ...(n > PREVIEW_ITEMS ? [h('p', { class: 'muted ac-more' }, `…and ${n - PREVIEW_ITEMS} more`)] : []),
    );
  };

  applyBtn.addEventListener('click', () => {
    if (runAutoCode([...chosen], options(), code.value, color.value)) close();
  });
  for (const el of [phrases, code, separators]) el.addEventListener('input', update);
  for (const el of [matchCase, wholeWords, scopeOcc, scopePara, breakLine, breakBlank, breakCustom]) el.addEventListener('change', update);

  renderDocs();
  renderPreview();

  return h(
    'div',
    { class: 'cc-panel ac-panel' },
    h('label', { class: 'label' }, 'Words or phrases you want to auto-code'),
    phrases,
    h('div', { class: 'ac-row' }, h('label', {}, wholeWords, ' Whole words/ phrases only'), h('label', {}, matchCase, ' Match upper/lower case')),
    h('label', { class: 'label' }, 'Code them as'),
    h('div', { class: 'row' }, color, code),
    codeNote,
    codePathOptions('ac-code-paths'),
    h('label', { class: 'label' }, 'What to code'),
    h('div', { class: 'ac-row' }, h('label', {}, scopeOcc, ' Each occurrence'), h('label', {}, scopePara, ' The paragraph containing it')),
    paragraphOptions,
    h('label', { class: 'label ac-docs-label' }, h('span', { class: 'grow' }, 'Documents'), h('label', { class: 'ac-all' }, allBox, ' All documents')),
    docList,
    h('label', { class: 'label' }, 'Preview'),
    preview,
    h('div', { class: 'cc-actions' }, h('span', { class: 'muted grow' }, 'Codes go into your coding; Undo reverts the whole auto-coding.'), applyBtn),
  );
}
