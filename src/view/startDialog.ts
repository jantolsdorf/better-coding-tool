// The dialog to start with: a new, empty project or a project file (this app's .zip/.json, or a
// REFI-QDA .qdpx). Shown on first use and for "New".
//
// The coder's name is only asked when starting a new project (an opened project already says who
// coded it) — or when an opened file does not say.

import { setCoderName } from '../controller/preferences';
import {
  exportProject,
  hasChangesNotDownloaded,
  importProjectInteractive,
  startNewProject,
} from '../controller/transfer';
import { project } from '../model/state';
import { h } from './dom';

/** `firstUse`: nobody has coded here yet; the dialog cannot be dismissed without choosing. */
export function openStartDialog({ firstUse }: { firstUse: boolean }) {
  const title = h('strong', {}, firstUse ? 'Welcome to Better Coding Tool' : 'New project');
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot' });
  const form = h('form', { class: 'modal-inner', method: 'dialog' }, h('div', { class: 'modal-head' }, title), body, foot);
  const dlg = h('dialog', { class: 'modal start' }, form);
  let onSubmit = () => {};
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit();
  });

  const button = (label: string, cls: string, onClick?: () => void, submit = false) =>
    h('button', { type: submit ? 'submit' : 'button', class: `btn ${cls}`, onClick }, label);

  /** Step 1: a new project, or a project file. */
  function showChoice() {
    title.textContent = firstUse ? 'Welcome to Better Coding Tool' : 'New project';
    const hasContent = project.docs.length > 0 || project.codes.length > 0 || project.memos.length > 0;
    const parts: HTMLElement[] = [
      h('p', {}, firstUse ? 'Start a new project, or open one you (or a colleague) exported before.' : 'Start a new, empty project, or open a project file.'),
      h('p', { class: 'muted small' }, 'Project files: this app’s export (.zip or .json), or a REFI-QDA project (.qdpx) from MAXQDA, NVivo, ATLAS.ti and others.'),
    ];
    if (!firstUse && hasContent) {
      parts.push(
        h(
          'p',
          { class: 'muted' },
          `Either replaces the current project in this browser (${project.docs.length} document(s), ${project.segments.length} coded segment(s), ${project.memos.length} memo(s)).`,
        ),
      );
    }
    if (!firstUse && hasChangesNotDownloaded()) {
      const download = button('Download copy', 'small', () => {
        exportProject();
        warning.replaceChildren('Downloaded. You can now start over safely.');
      });
      const warning = h('div', { class: 'start-warning' }, h('span', { class: 'grow' }, 'Its latest changes are not in a downloaded copy yet.'), download);
      parts.push(warning);
    }
    body.replaceChildren(...parts);
    const newBtn = button('Start a new project', 'primary', undefined, true);
    const openBtn = button('Open a project file…', '', async () => {
      // The dialog already said that the current project is replaced.
      if (!(await importProjectInteractive({ confirmReplace: false }))) return;
      // The opened project names its coder; ask only if it does not.
      if (project.coderName) dlg.close();
      else showName('opened');
    });
    foot.replaceChildren(...(firstUse ? [] : [button('Cancel', '', () => dlg.close())]), h('span', { class: 'grow' }), openBtn, newBtn);
    onSubmit = () => {
      // Someone new starting a project is asked for their name first.
      if (!project.coderName) showName('new');
      else {
        startNewProject();
        dlg.close();
      }
    };
    // Enter should never discard changes that are only in this browser.
    (body.querySelector<HTMLButtonElement>('.start-warning button') ?? newBtn).focus();
  }

  /** Step 2: the coder's name, for a new project or for an opened project that does not name one. */
  function showName(reason: 'new' | 'opened') {
    title.textContent = reason === 'new' ? 'Your name' : 'Who is coding?';
    const input = h('input', { type: 'text', class: 'field', placeholder: 'e.g. Jan', autocomplete: 'name', spellcheck: 'false' });
    body.replaceChildren(
      h(
        'p',
        { class: 'muted' },
        (reason === 'opened' ? 'The opened project does not say who coded it. ' : '') +
          'What is your name? It labels your coding when you export your project and when others compare their coding with yours. You can change it later at the top.',
      ),
      h('label', { class: 'label' }, 'Your name'),
      input,
    );
    const go = button(reason === 'new' ? 'Start coding' : 'Continue', 'primary', undefined, true);
    go.disabled = true;
    input.addEventListener('input', () => (go.disabled = !input.value.trim()));
    // Going back only makes sense before anything was opened.
    foot.replaceChildren(...(reason === 'new' ? [button('Back', '', showChoice)] : []), h('span', { class: 'grow' }), go);
    onSubmit = () => {
      if (!setCoderName(input.value)) return;
      if (reason === 'new') startNewProject();
      dlg.close();
    };
    input.focus();
  }

  // On first use, Escape would leave the app without a project or name.
  if (firstUse) dlg.addEventListener('cancel', (e) => e.preventDefault());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  showChoice();
}
