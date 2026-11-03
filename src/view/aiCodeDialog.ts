// The AI coding dialog. Setup: the codes to apply, the documents, how the text is split
// (paragraphs, or whole documents where the model quotes passages) and whether coded examples
// are shared. Then the requests run (with progress, cancellable) and each suggestion is reviewed:
// it fits or it does not. Only accepted suggestions are coded, as one undo step.

import './aiCode.css';
import { applyAccepted, runAiJob } from '../controller/aiCoding';
import { aiBatches, textSize, type AiJob, type AiSplit, type AiSuggestion } from '../model/aiCoding';
import { aiConfigured, aiHost, loadAiSettings, type AiSettings } from '../model/aiSettings';
import type { ParagraphBreak } from '../model/autoCode';
import { codeById, codeChain, codePath, codesInTreeOrder, subtreeOf } from '../model/codes';
import { getDoc } from '../model/documents';
import { lineLabel } from '../model/lines';
import { project } from '../model/state';
import { openAiSettings } from './aiSettingsDialog';
import { docPicker } from './docPicker';
import { h, hexToRgba } from './dom';
import { confirmAction, notify } from './feedback';
import { cycleWithChildren } from './multiSelect';
import { currentDocument } from './windows';

/** Asking before a job with this many requests (each costs time and, with paid APIs, money). */
const MANY_REQUESTS = 40;

export async function openAiCodeDialog() {
  let settings = loadAiSettings();
  if (!aiConfigured(settings)) {
    const set = await openAiSettings();
    if (!set || !aiConfigured(set)) return;
    settings = set;
  }
  if (!project.codes.length) return notify('Create the codes first: AI coding applies codes from your codebook.', 'No codes yet');
  if (!project.docs.length) return notify('Add documents first.', 'No documents');

  const dlg = h('dialog', { class: 'modal ai-code' });
  const body = h('div', { class: 'modal-body ai-body' });
  const foot = h('div', { class: 'modal-foot' });
  const title = h('strong', { class: 'grow' }, 'AI coding');
  let controller: AbortController | null = null;
  let suggestions: AiSuggestion[] = [];
  let closeOk = false;

  const close = () => {
    closeOk = true;
    dlg.close();
  };
  dlg.addEventListener('close', () => {
    controller?.abort();
    dlg.remove();
  });
  // Esc or Close: suggestions not applied yet are lost, so ask first.
  const requestClose = async () => {
    const pending = suggestions.some((s) => s.status !== 'rejected');
    if (!pending || closeOk) return close();
    const ok = await confirmAction('Suggestions you have not applied are lost.', {
      title: 'Close AI coding?',
      confirm: 'Close and discard',
      cancel: 'Keep reviewing',
      danger: true,
    });
    if (ok) close();
  };
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    void requestClose();
  });

  dlg.append(
    h(
      'div',
      { class: 'modal-inner' },
      h(
        'div',
        { class: 'modal-head' },
        title,
        h('button', { type: 'button', class: 'btn small', title: 'API, key and model', onClick: () => void editSettings() }, 'AI settings…'),
      ),
      body,
      foot,
    ),
  );
  currentDocument().body.append(dlg);
  dlg.showModal();

  const editSettings = async () => {
    const set = await openAiSettings();
    if (set) settings = set;
    setup.refresh();
  };

  // ---------------- setup ----------------
  const setup = setupPanel(() => settings, (job) => void run(job), requestClose);
  const showSetup = () => {
    title.textContent = 'AI coding';
    body.replaceChildren(setup.el);
    foot.replaceChildren(...setup.foot);
    setup.refresh();
  };

  // ---------------- running and review ----------------
  const run = async (job: AiJob) => {
    const total = aiBatches(job).length;
    if (total > MANY_REQUESTS) {
      const ok = await confirmAction(`This sends ${total} requests to ${aiHost(settings)}. With a paid API, each request costs money.`, {
        title: `Send ${total} requests?`,
        confirm: `Send ${total} requests`,
      });
      if (!ok) return;
    }
    suggestions = [];
    const review = reviewPanel(() => suggestions, job);
    title.textContent = 'AI coding: review the suggestions';
    body.replaceChildren(review.el);
    controller = new AbortController();
    const cancelBtn = h('button', { type: 'button', class: 'btn', onClick: () => controller?.abort() }, 'Stop requests');
    const applyBtn = h('button', { type: 'button', class: 'btn primary', onClick: () => applyAccepted(suggestions) && close() }, 'Apply');
    const backBtn = h('button', {
      type: 'button',
      class: 'btn',
      title: 'Change the codes, documents or options and send again',
      onClick: async () => {
        const pending = suggestions.some((s) => s.status !== 'rejected');
        if (pending && !(await confirmAction('Suggestions you have not applied are lost.', { title: 'Start over?', confirm: 'Discard and start over', cancel: 'Keep reviewing', danger: true }))) return;
        suggestions = [];
        showSetup();
      },
    }, 'Start over');
    const updateApply = () => {
      const n = suggestions.filter((s) => s.status === 'accepted').length;
      applyBtn.disabled = !n;
      applyBtn.textContent = n ? `Code ${n} accepted passage${n === 1 ? '' : 's'}` : 'Code accepted passages';
    };
    review.onStatusChange(updateApply);
    foot.replaceChildren(backBtn, cancelBtn, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn', onClick: () => void requestClose() }, 'Close'), applyBtn);
    updateApply();
    review.progress(0, total);
    try {
      await runAiJob(settings, job, controller.signal, (p) => {
        suggestions.push(...p.suggestions);
        review.add(p.suggestions, p.problems);
        review.progress(p.done, p.total);
      });
      review.finished(controller.signal.aborted ? 'Stopped. The suggestions so far can be reviewed.' : '');
    } catch (e) {
      review.finished((e as Error).message, true);
    }
    controller = null;
    cancelBtn.remove();
    updateApply();
  };

  showSetup();
}

// ======================= setup panel =======================

function setupPanel(settings: () => AiSettings, onRun: (job: AiJob) => void, onClose: () => void) {
  // ---- codes ----
  const chosenCodes = new Set<string>();
  const filter = h('input', { type: 'search', class: 'field', placeholder: 'Filter codes…' });
  const codeList = h('div', { class: 'ai-codes' });
  const codeCount = h('span', { class: 'muted' });
  const renderCodes = () => {
    const q = filter.value.trim().toLowerCase();
    codeList.replaceChildren(
      ...codesInTreeOrder()
        .filter((c) => !q || codePath(c).toLowerCase().includes(q))
        .map((c) => {
          const box = h('input', { type: 'checkbox', checked: chosenCodes.has(c.id) });
          // A parent code: itself, then with its subcodes, then none (see cycleWithChildren).
          box.addEventListener('change', () => {
            cycleWithChildren(chosenCodes, c.id, subtreeOf(c.id).filter((x) => x.id !== c.id).map((x) => x.id));
            renderCodes();
            update();
          });
          return h(
            'label',
            { class: 'ai-code-row', style: { paddingLeft: `${(codeChain(c).length - 1) * 16 + 4}px` }, title: c.description || 'No definition: the AI only sees the name.' },
            box,
            h('span', { class: 'swatch', style: { background: c.color } }),
            h('span', { class: 'ai-code-name' }, c.name),
            c.description?.trim() ? null : h('span', { class: 'ai-tag' }, 'no definition'),
          );
        }),
    );
  };
  filter.addEventListener('input', renderCodes);
  const setAllCodes = (on: boolean) => {
    const q = filter.value.trim().toLowerCase();
    for (const c of codesInTreeOrder()) if (!q || codePath(c).toLowerCase().includes(q)) on ? chosenCodes.add(c.id) : chosenCodes.delete(c.id);
    renderCodes();
    update();
  };

  // ---- documents ----
  const docs = docPicker(() => update());

  // ---- splitting ----
  const name = `ai-split-${Math.random().toString(36).slice(2)}`;
  const radio = (group: string, value: string, checked = false) => h('input', { type: 'radio', name: group, value, checked });
  const byParagraph = radio(name, 'paragraph', true);
  const byDocument = radio(name, 'document');
  const breakLine = radio(`${name}-b`, 'line');
  const breakBlank = radio(`${name}-b`, 'blank', true);
  const breakCustom = radio(`${name}-b`, 'custom');
  const separators = h('textarea', { class: 'field', rows: 2, placeholder: 'One separator per line, e.g.\nInterviewer:' });
  const paragraphOptions = h(
    'div',
    { class: 'ac-paragraph-options' },
    h('span', { class: 'muted' }, 'A paragraph ends at'),
    h('label', {}, breakLine, ' every line break'),
    h('label', {}, breakBlank, ' empty lines'),
    h('label', {}, breakCustom, ' custom separators (a new paragraph starts where one occurs):'),
    separators,
  );

  // ---- examples ----
  const shareExamples = h('input', { type: 'checkbox' });
  const perCode = h('select', { class: 'field' }, ...[1, 2, 3, 5, 10].map((n) => h('option', { value: String(n), selected: n === 3 }, String(n))));
  const exampleNote = h('span', { class: 'muted' });

  // ---- summary and sending ----
  const summary = h('div', { class: 'ai-summary' });
  const sendBtn = h('button', { type: 'button', class: 'btn primary' }, 'Send');

  const split = (): AiSplit =>
    byDocument.checked
      ? { mode: 'document' }
      : {
          mode: 'paragraph',
          paragraphBreak: (breakLine.checked ? 'line' : breakCustom.checked ? 'custom' : 'blank') as ParagraphBreak,
          separators: separators.value.split('\n').map((s) => s.trim()).filter(Boolean),
        };
  const job = (): AiJob => ({
    codeIds: codesInTreeOrder().filter((c) => chosenCodes.has(c.id)).map((c) => c.id),
    docIds: [...docs.chosen],
    split: split(),
    examplesPerCode: shareExamples.checked ? Number(perCode.value) : 0,
    batchChars: settings().batchChars,
  });

  const update = () => {
    const s = settings();
    const j = job();
    codeCount.textContent = `${j.codeIds.length} chosen`;
    paragraphOptions.hidden = j.split.mode !== 'paragraph';
    separators.disabled = !breakCustom.checked;
    const withExamples = j.codeIds.filter((id) => project.segments.some((seg) => seg.codeId === id)).length;
    exampleNote.textContent = j.codeIds.length ? `${withExamples} of ${j.codeIds.length} chosen codes have coded passages to share.` : '';
    perCode.disabled = !shareExamples.checked;

    const why = !j.codeIds.length
      ? 'Choose at least one code.'
      : !j.docIds.length
        ? 'Choose at least one document.'
        : j.split.mode === 'paragraph' && j.split.paragraphBreak === 'custom' && !j.split.separators.length
          ? 'Enter at least one separator (or choose another way paragraphs end).'
          : '';
    sendBtn.textContent = `Send to ${aiHost(s)}`;
    if (why) {
      summary.replaceChildren(h('p', { class: 'muted' }, why));
      sendBtn.disabled = true;
      return;
    }
    const batches = aiBatches(j);
    const units = batches.flat().length;
    const chars = textSize(batches);
    sendBtn.disabled = !batches.length;
    summary.replaceChildren(
      h(
        'p',
        {},
        j.split.mode === 'paragraph'
          ? `${units} paragraph${units === 1 ? '' : 's'} in ${batches.length} request${batches.length === 1 ? '' : 's'}`
          : `${j.docIds.length} document${j.docIds.length === 1 ? '' : 's'} in ${batches.length} request${batches.length === 1 ? '' : 's'}`,
        ` · about ${chars.toLocaleString()} characters of text · model ${s.model}`,
      ),
      h(
        'p',
        { class: 'ai-privacy' },
        `The text of the chosen documents${j.examplesPerCode ? ', the shared examples' : ''} and the chosen codes with their definitions are sent to `,
        h('strong', {}, aiHost(s)),
        '. Make sure this is allowed for your data (participants’ consent, ethics approval, data protection).',
      ),
    );
  };
  for (const el of [byParagraph, byDocument, breakLine, breakBlank, breakCustom, shareExamples, perCode]) el.addEventListener('change', update);
  separators.addEventListener('input', update);
  sendBtn.addEventListener('click', () => onRun(job()));

  renderCodes();
  const el = h(
    'div',
    { class: 'ai-setup' },
    h('label', { class: 'label ai-section' }, h('span', { class: 'grow' }, '1 · Codes to apply '), codeCount),
    h(
      'div',
      { class: 'row' },
      filter,
      h('button', { type: 'button', class: 'btn small', onClick: () => setAllCodes(true) }, 'All'),
      h('button', { type: 'button', class: 'btn small', onClick: () => setAllCodes(false) }, 'None'),
    ),
    codeList,
    h('p', { class: 'muted ai-note' }, 'The AI decides by each code’s name and definition (code details → Description). Codes without a definition are guessed from the name.'),
    h('label', { class: 'label ai-section ac-docs-label' }, h('span', { class: 'grow' }, '2 · Documents'), h('label', { class: 'ac-all' }, docs.allBox, ' All documents')),
    docs.list,
    h('label', { class: 'label ai-section' }, '3 · How the text is sent'),
    h(
      'div',
      { class: 'ai-choices' },
      h('label', {}, byParagraph, h('span', {}, h('strong', {}, 'Paragraph by paragraph'), ' — the AI reads one paragraph at a time and quotes the sentences in it that make the point.')),
      paragraphOptions,
      h('label', {}, byDocument, h('span', {}, h('strong', {}, 'Whole documents'), ' — the AI reads the whole text (long documents in pieces) and quotes the sentences that make the point.')),
    ),
    h('label', { class: 'label ai-section' }, '4 · Examples'),
    h('label', { class: 'ai-check' }, shareExamples, ' Share passages you already coded with the chosen codes as examples, up to ', perCode, ' per code'),
    exampleNote,
    h('label', { class: 'label ai-section' }, 'Summary'),
    summary,
  );
  const foot = [h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn', onClick: onClose }, 'Close'), sendBtn];
  return { el, foot, refresh: update };
}

// ======================= review panel =======================

function reviewPanel(all: () => AiSuggestion[], job: AiJob) {
  const listeners: (() => void)[] = [];
  const changed = () => listeners.forEach((f) => f());

  const progressBar = h('progress', { class: 'ai-progress', max: 1, value: 0 });
  const progressText = h('span', { class: 'muted' });
  const counts = h('span', { class: 'ai-counts' });
  const codeFilter = h('select', { class: 'field' }, h('option', { value: '' }, 'All codes'), ...job.codeIds.map((id) => h('option', { value: id }, codePath(codeById(id)!))));
  const statusFilter = h(
    'select',
    { class: 'field' },
    h('option', { value: '' }, 'All suggestions'),
    h('option', { value: 'open' }, 'Not decided'),
    h('option', { value: 'accepted' }, 'Fits'),
    h('option', { value: 'rejected' }, 'Does not fit'),
  );
  const list = h('div', { class: 'ai-list' });
  const problemList = h('ul', {});
  const problems = h('details', { class: 'ai-problems', hidden: true }, h('summary', {}), problemList);
  const message = h('p', { class: 'ai-message', hidden: true });

  const shown = () =>
    all().filter((s) => (!codeFilter.value || s.codeId === codeFilter.value) && (!statusFilter.value || s.status === statusFilter.value));
  const renderCounts = () => {
    const s = all();
    const n = (st: AiSuggestion['status']) => s.filter((x) => x.status === st).length;
    counts.textContent = `${s.length} suggestion${s.length === 1 ? '' : 's'} · ${n('accepted')} fit · ${n('rejected')} do not fit · ${n('open')} not decided`;
  };
  const setStatus = (items: AiSuggestion[], status: AiSuggestion['status']) => {
    for (const s of items) s.status = status;
    render();
    changed();
  };

  const card = (s: AiSuggestion): HTMLElement => {
    const code = codeById(s.codeId);
    const doc = getDoc(s.docId);
    if (!code || !doc) return h('div', {});
    // The coded sentences, marked within their paragraph (shortened around them until expanded).
    const [from, to] = s.context;
    const before = doc.content.slice(from, s.start);
    const after = doc.content.slice(s.end, to);
    const el = h('div', { class: `ai-sugg ${s.status}` });
    const toggle = (st: AiSuggestion['status']) => () => {
      s.status = s.status === st ? 'open' : st;
      el.replaceWith(card(s));
      renderCounts();
      changed();
    };
    const quote = h('blockquote', { class: 'ai-sugg-text', title: 'Click to show the whole paragraph or less', style: { borderLeftColor: code.color } });
    const renderQuote = (full: boolean) => {
      const near = 160;
      const pre = full || before.length <= near ? before : `…${before.slice(-near).replace(/^\S*\s/, '')}`;
      const post = full || after.length <= near ? after : `${after.slice(0, near).replace(/\s\S*$/, '')}…`;
      quote.replaceChildren(
        h('span', { class: 'ai-context' }, pre),
        h('mark', { class: 'ai-coded', style: { background: hexToRgba(code.color, 0.25) } }, doc.content.slice(s.start, s.end)),
        h('span', { class: 'ai-context' }, post),
      );
    };
    renderQuote(false);
    quote.addEventListener('click', () => renderQuote(quote.classList.toggle('expanded')));
    el.append(
      h(
        'div',
        { class: 'ai-sugg-head' },
        h('span', { class: 'swatch', style: { background: code.color } }),
        h('strong', { class: 'ai-sugg-code', title: codePath(code) }, codePath(code)),
        s.alreadyCoded ? h('span', { class: 'ai-tag', title: 'Your coding already has this code here' }, 'already coded') : null,
        h('span', { class: 'grow' }),
        h('span', { class: 'muted ai-sugg-where' }, `${doc.name} ${lineLabel(doc, s.start, s.end)}`),
      ),
      quote,
      ...(s.reason ? [h('p', { class: 'ai-sugg-reason' }, s.reason)] : []),
      h(
        'div',
        { class: 'ai-sugg-actions' },
        h('button', { type: 'button', class: `btn small fits${s.status === 'accepted' ? ' on' : ''}`, 'aria-pressed': String(s.status === 'accepted'), onClick: toggle('accepted') }, '✓ Fits'),
        h('button', { type: 'button', class: `btn small misfit${s.status === 'rejected' ? ' on' : ''}`, 'aria-pressed': String(s.status === 'rejected'), onClick: toggle('rejected') }, '✗ Does not fit'),
      ),
    );
    return el;
  };

  const render = () => {
    renderCounts();
    const items = shown();
    list.replaceChildren(...(items.length ? items.map(card) : [h('p', { class: 'muted' }, all().length ? 'No suggestions match the filter.' : 'No suggestions yet.')]));
  };
  codeFilter.addEventListener('change', render);
  statusFilter.addEventListener('change', render);

  const el = h(
    'div',
    { class: 'ai-review' },
    h('div', { class: 'ai-progress-row' }, progressBar, progressText),
    message,
    h(
      'div',
      { class: 'ai-toolbar' },
      counts,
      h('span', { class: 'grow' }),
      codeFilter,
      statusFilter,
      h('button', { type: 'button', class: 'btn small', title: 'Mark all shown suggestions that are not decided as fitting', onClick: () => setStatus(shown().filter((s) => s.status === 'open'), 'accepted') }, 'All shown fit'),
      h('button', { type: 'button', class: 'btn small', title: 'Mark all shown suggestions that are not decided as not fitting', onClick: () => setStatus(shown().filter((s) => s.status === 'open'), 'rejected') }, 'None of the shown fit'),
    ),
    problems,
    list,
  );
  render();

  return {
    el,
    onStatusChange: (f: () => void) => listeners.push(f),
    progress(done: number, total: number) {
      progressBar.max = Math.max(1, total);
      progressBar.value = done;
      progressText.textContent = done < total ? `Request ${done + 1} of ${total}…` : `${total} request${total === 1 ? '' : 's'} done`;
    },
    add(items: AiSuggestion[], issues: string[]) {
      if (issues.length) {
        problemList.append(...issues.map((p) => h('li', {}, p)));
        problems.hidden = false;
        const n = problemList.children.length;
        problems.querySelector('summary')!.textContent = `${n} problem${n === 1 ? '' : 's'} (e.g. quotes not found, failed requests)`;
      }
      if (items.length) render();
      else renderCounts();
      changed();
    },
    finished(text: string, error = false) {
      progressBar.hidden = true;
      if (!all().length && !text) text = 'The AI found no passages that the chosen codes fit.';
      if (text) {
        message.textContent = text;
        message.className = `ai-message${error ? ' error' : ''}`;
        message.hidden = false;
      }
      progressText.textContent = '';
      render();
    },
  };
}
