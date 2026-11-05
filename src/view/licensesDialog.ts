// The Licenses dialog: the open-source software the app is built with, with each license as its
// package ships it (collected at build time, see build/licenses.ts).

import licenses from 'virtual:third-party-licenses';
import { h } from './dom';
import { currentDocument } from './windows';

/** A license's name in parentheses (SPDX expressions with several have their own). */
const label = (license: string) => (license.startsWith('(') ? license : `(${license})`);

export function openLicensesDialog() {
  const dlg = h('dialog', { class: 'modal licenses' });
  const close = h('button', { type: 'button', class: 'btn primary', onClick: () => dlg.close() }, 'Close');
  dlg.append(
    h(
      'div',
      { class: 'modal-inner' },
      h('div', { class: 'modal-head' }, h('strong', {}, 'Licenses')),
      h(
        'div',
        { class: 'modal-body' },
        h('p', {}, 'Better Coding Tool is built with this open-source software. Thanks to its authors! Its licenses ask that these notices go with the tool; they are also at the top of the tool’s file.'),
        h('p', { class: 'muted' }, 'Icons: Font Awesome Free by Fonticons, Inc. (fontawesome.com), licensed under CC BY 4.0.'),
        ...licenses.map((l) =>
          h(
            'details',
            { class: 'license-item' },
            h('summary', {}, h('strong', {}, l.name), ` ${l.version} `, h('span', { class: 'muted' }, label(l.license))),
            l.homepage ? h('p', {}, h('a', { href: l.homepage, target: '_blank', rel: 'noopener noreferrer' }, l.homepage)) : null,
            h('pre', { class: 'license-text' }, l.text),
          ),
        ),
      ),
      h('div', { class: 'modal-foot' }, h('span', { class: 'grow' }), close),
    ),
  );
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  currentDocument().body.append(dlg);
  dlg.showModal();
  close.focus();
}
