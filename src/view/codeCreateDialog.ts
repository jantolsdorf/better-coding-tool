// The "+ Code" dialog: creating a new code (first tab), or auto-coding words and phrases in
// documents (second tab, see autoCodeTab.ts).

import './codeCreateDialog.css';
import { createCodeFromDialog } from '../controller/codes';
import { nextColor } from '../model/codes';
import { h } from './dom';
import { autoCodeTab, codePathOptions } from './autoCodeTab';
import { currentDocument } from './windows';

export type CodeCreateTab = 'code' | 'auto';

export function openCodeCreateDialog(tab: CodeCreateTab = 'code') {
  const dlg = h('dialog', { class: 'modal code-create' });
  const close = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());

  const panels: Record<CodeCreateTab, HTMLElement> = {
    code: newCodeTab(close),
    auto: autoCodeTab(close),
  };
  const tabButton = (key: CodeCreateTab, label: string, title: string) =>
    h('button', { type: 'button', class: 'cc-tab', role: 'tab', title, onClick: () => show(key), 'data-tab': key }, label);
  const tabs = h(
    'div',
    { class: 'cc-tabs', role: 'tablist' },
    tabButton('code', 'New code', 'Create a code without coding a passage'),
    tabButton('auto', 'Auto-code', 'Code all occurrences of words or phrases (or their paragraphs) in chosen documents'),
  );
  const body = h('div', { class: 'cc-body' });
  const show = (key: CodeCreateTab) => {
    for (const b of tabs.querySelectorAll<HTMLElement>('.cc-tab')) {
      const on = b.dataset.tab === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    body.replaceChildren(panels[key]);
    panels[key].querySelector<HTMLElement>('input, textarea')?.focus();
  };

  dlg.append(
    h(
      'div',
      { class: 'modal-inner' },
      h('div', { class: 'modal-head' }, tabs, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn', onClick: close }, 'Close')),
      body,
    ),
  );
  currentDocument().body.append(dlg);
  dlg.showModal();
  show(tab);
}

/** First tab: a code's name ("Parent > Child" for a subcode), color and description. */
function newCodeTab(close: () => void): HTMLElement {
  const name = h('input', {
    type: 'text',
    class: 'field',
    placeholder: 'code   or   parent code > subcode',
    list: 'cc-code-paths',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const color = h('input', { type: 'color', class: 'swatch-input big', value: nextColor(), title: 'Color (subcodes take their level 1 code’s color)' });
  const desc = h('textarea', { class: 'field', rows: 3, placeholder: 'Definition / when to apply this code… (optional)' });
  const create = () => {
    if (createCodeFromDialog(name.value, color.value, desc.value)) close();
  };
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      create();
    }
  });
  return h(
    'div',
    { class: 'cc-panel' },
    h('label', { class: 'label' }, 'Name'),
    h('div', { class: 'row' }, color, name),
    h('p', { class: 'muted cc-hint' }, 'Type “parent code > subcode” to create a subcode; missing parent codes are created too. To code a passage, select it in the text instead.'),
    h('label', { class: 'label' }, 'Description'),
    desc,
    codePathOptions('cc-code-paths'),
    h('div', { class: 'cc-actions' }, h('button', { type: 'button', class: 'btn primary', onClick: create }, 'Create code')),
  );
}
