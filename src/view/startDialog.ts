// The dialog to start with: a new, empty project or a project file (this app's .zip/.json, or a
// REFI-QDA .qdpx). Shown on first use and for "New".
//
// The coder's name is only asked when starting a new project (an opened project already says who
// coded it) — or when an opened file does not say.

import './startDialog.css';
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

  /** Step 1: what the tool does, and a new project, a project file, or the FAQ. */
  function showChoice() {
    title.textContent = firstUse ? 'Welcome to Better Coding Tool' : 'New project';
    const hasContent = project.docs.length > 0 || project.codes.length > 0 || project.memos.length > 0;
    const parts: HTMLElement[] = [
      h('p', {}, 'Qualitative coding of text documents, right in your browser.'),
      h(
        'ul',
        { class: 'start-features' },
        h('li', {}, 'Code interview transcripts (.txt files)'),
        h('li', {}, 'Organize your codebook with subcodes, colors, descriptions, etc.'),
        h('li', {}, 'Add memos to your documents'),
        h('li', {}, 'Compare with other coders, challenge their codes, and consolidate an agreed coding'),
        h('li', {}, 'Import and export: project files, codebooks (JSON/CSV), CSV tables, REFI-QDA (MAXQDA, NVivo, ATLAS.ti)'),
        h('li', {}, 'Everything stays on your computer: no account, no servers'),
      ),
    ];
    if (!firstUse && hasContent) {
      parts.push(
        h(
          'p',
          { class: 'muted' },
          `A new project or an opened file replaces the current project in this browser (${project.docs.length} document(s), ${project.segments.length} coded segment(s), ${project.memos.length} memo(s)).`,
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
    const newBtn = button('Start a new project', 'primary', undefined, true);
    const openBtn = button('Open a project file…', '', async () => {
      // The dialog already said that the current project is replaced.
      if (!(await importProjectInteractive({ confirmReplace: false }))) return;
      // The opened project names its coder; ask only if it does not.
      if (project.coderName) dlg.close();
      else showName('opened');
    });
    parts.push(
      h('div', { class: 'start-actions' }, openBtn, newBtn, button('FAQ', 'ghost', showFaq)),
      h('p', { class: 'muted small start-files' }, 'Project files: this app’s export (.zip or .json), or a REFI-QDA project (.qdpx) from MAXQDA, NVivo, ATLAS.ti and others.'),
    );
    body.replaceChildren(...parts);
    foot.replaceChildren(...(firstUse ? [] : [h('span', { class: 'grow' }), button('Cancel', '', () => dlg.close())]));
    foot.hidden = firstUse;
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

  /** Frequently asked questions, each one opened by clicking it. */
  function showFaq() {
    title.textContent = 'FAQ';
    const qa = (q: string, open: boolean, ...a: (HTMLElement | string)[]) =>
      h('details', { class: 'faq-item', open }, h('summary', {}, q), h('div', { class: 'faq-answer' }, ...a));
    body.replaceChildren(
      qa(
        'Is my data sent anywhere?',
        true,
        h('p', {}, 'No. Everything stays on your computer. The tool makes no network requests: no upload, no account, no tracking, no fonts or scripts from other servers.'),
        h('p', {}, 'Your documents, codes and memos are saved in this browser’s local storage, on this computer and in this browser only. To keep a backup, move to another computer or share your work, use “Export project”: it downloads a file that you keep or pass on yourself.'),
        h('p', { class: 'muted' }, 'Clearing the browser’s data for this site (or a private window being closed) deletes what is stored there, so export regularly.'),
      ),
      qa(
        'It runs in my browser — how can it be offline?',
        false,
        h('p', {}, 'The browser is only the program that runs the tool, like a PDF viewer shows a PDF. The whole tool is one web page with everything inside it. Once the page is loaded, all the work happens on your computer; nothing is fetched or sent afterwards.'),
        h('p', {}, 'If you open the tool from a web address, only the tool itself is downloaded, once, like any web page; your documents are never part of that. You can also save the page (one .html file) and open it from your computer without any internet connection.'),
      ),
      qa(
        'What is the basic workflow?',
        false,
        h(
          'ol',
          {},
          h('li', {}, 'Start a new project and add your transcripts as .txt files (“+ Files”, or drop them on the document list). Folders help to organize them.'),
          h('li', {}, 'Open a document and highlight a passage. Type a code (existing codes are suggested) and press Enter. “Parent > Child” creates a subcode; “memo: …” adds a memo.'),
          h('li', {}, 'Refine the codebook: rename, describe, nest, merge and order codes; drag pins to adjust coded passages.'),
          h('li', {}, 'Export the project regularly (“Export project”) as a backup and to share it.'),
          h('li', {}, 'To compare: each coder exports their project; import the others under “Compare ▾”. Their coding appears next to yours; review and challenge it, and consolidate an agreed coding.'),
          h('li', {}, 'Export results as CSV tables or as a REFI-QDA project for other QDA programs.'),
        ),
      ),
      qa(
        'Can several people code the same project?',
        false,
        h('p', {}, 'Yes, in two ways: everyone codes their own copy and you compare and consolidate them (Compare ▾), or the project file is passed on and each person codes under their own name (Coder ▾ in the top bar). Every code remembers who made it.'),
      ),
    );
    foot.hidden = false;
    foot.replaceChildren(button('Back', '', showChoice));
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
    foot.hidden = false;
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
