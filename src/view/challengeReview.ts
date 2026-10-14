// Reviewing another coder's codes to challenge the ones you do not agree with: either all
// passages of one code across all documents, or all codes of one document in text order.

import { challengeInteractive, exportChallengesCSV, setChallengeMode, withdrawChallenge } from '../controller/challenges';
import { goToSegment } from '../controller/codes';
import { setColumnVisible } from '../controller/comparison';
import { challengesOf, findChallenge } from '../model/challenges';
import { codePath, codesInTreeOrder, isCodeInSubtree } from '../model/codes';
import { docsInTreeOrder, folderPath, getDoc } from '../model/documents';
import { lineLabel } from '../model/lines';
import { project, subscribe, ui } from '../model/state';
import type { Code, Doc, ExternalCoding, Segment } from '../model/types';
import { h } from './dom';
import { closeToolWindow, openToolWindow } from './windows';

/** The last choices, so reopening the dialog continues where you left off. */
const state = {
  coderId: '',
  by: 'code' as 'code' | 'document',
  codeId: '',
  docId: '',
  subcodes: false,
  onlyChallenged: false,
};

export function openChallengeReview() {
  if (!project.externalCodings.length) return;
  let stop = () => {};
  const root = openToolWindow('review', 'Review & challenge codes', () => stop());
  if (!root) return; // already open (now in front), or blocked (see openToolWindow)
  const body = h('div', { class: 'modal-body review-body' });
  const tools = h('div', { class: 'review-tools' });
  const foot = h('div', { class: 'modal-foot' });

  const render = () => {
    if (!project.externalCodings.length) return closeToolWindow('review');
    const coder = project.externalCodings.find((x) => x.id === state.coderId) ?? project.externalCodings[0];
    state.coderId = coder.id;
    renderTools(tools, coder, render);
    renderList(body, coder, render);
    const mine = challengesOf(coder.coderName).length;
    const all = project.challenges.length;
    foot.replaceChildren(
      h('span', { class: 'muted grow' }, `${mine} challenge${mine === 1 ? '' : 's'} of ${coder.coderName}${all !== mine ? ` · ${all} in total` : ''}`),
      h('button', { class: 'btn', title: 'All your challenges with passage and comment, e.g. to send to the coders', onClick: exportChallengesCSV }, 'Export challenges (CSV)'),
    );
  };

  root.append(
    h(
      'div',
      { class: 'modal-inner tool-inner' },
      h(
        'div',
        { class: 'modal-head' },
        h('strong', { class: 'grow' }, '⚑ Review & challenge codes'),
        h('button', { class: 'btn', onClick: () => closeToolWindow('review') }, 'Close'),
      ),
      tools,
      body,
      foot,
    ),
  );
  render();
  // Stays up to date with changes made in the main window (e.g. challenges in the columns).
  stop = subscribe(render);
}

function select(options: [string, string][], value: string, onChange: (v: string) => void, title = ''): HTMLSelectElement {
  return h(
    'select',
    { class: 'field', title, onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
    ...options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)),
  );
}

function renderTools(tools: HTMLElement, coder: ExternalCoding, render: () => void) {
  const coderSelect = select(
    project.externalCodings.map((x) => [x.id, `${x.coderName} (${x.segments.length})`]),
    coder.id,
    (v) => {
      state.coderId = v;
      state.codeId = '';
      render();
    },
    'Whose coding to review',
  );
  const tab = (by: typeof state.by, label: string) =>
    h(
      'button',
      {
        class: 'seg-toggle' + (state.by === by ? ' on' : ''),
        onClick: () => {
          state.by = by;
          render();
        },
      },
      label,
    );

  let picker: HTMLElement;
  if (state.by === 'code') {
    const count = new Map<string, number>();
    for (const s of coder.segments) count.set(s.codeId, (count.get(s.codeId) ?? 0) + 1);
    const codes = codesInTreeOrder(null, 0, coder.codes).filter((c) => count.has(c.id) || coder.codes.some((x) => x.parentId === c.id));
    if (!codes.some((c) => c.id === state.codeId)) state.codeId = codes.find((c) => count.has(c.id))?.id ?? '';
    picker = h(
      'span',
      { class: 'review-picker' },
      select(
        codes.map((c) => [c.id, `${codePath(c, coder.codes)} (${count.get(c.id) ?? 0})`]),
        state.codeId,
        (v) => {
          state.codeId = v;
          render();
        },
        'Code to review',
      ),
      checkbox('Subcodes', 'Also show the passages of its subcodes', state.subcodes, (v) => {
        state.subcodes = v;
        render();
      }),
    );
  } else {
    const docs = docsInTreeOrder().filter((d) => coder.segments.some((s) => s.docId === d.id));
    if (!docs.some((d) => d.id === state.docId)) state.docId = (docs.find((d) => d.id === ui.selectedDocId) ?? docs[0])?.id ?? '';
    picker = select(
      docs.map((d) => [d.id, `${docLabel(d)} (${coder.segments.filter((s) => s.docId === d.id).length})`]),
      state.docId,
      (v) => {
        state.docId = v;
        render();
      },
      'Document to go through',
    );
  }
  tools.replaceChildren(
    h('label', { class: 'review-label' }, 'Coder'),
    coderSelect,
    h('span', { class: 'review-tabs' }, tab('code', 'By code'), tab('document', 'By document')),
    picker,
    h('span', { class: 'grow' }),
    checkbox('Only challenged', 'Show only the passages you challenged', state.onlyChallenged, (v) => {
      state.onlyChallenged = v;
      render();
    }),
  );
}

function checkbox(label: string, title: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  return h(
    'label',
    { class: 'review-check', title },
    h('input', { type: 'checkbox', checked, onChange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
    ` ${label}`,
  );
}

const docLabel = (d: Doc) => {
  const path = folderPath(d.folderId);
  return path ? `${path} / ${d.name}` : d.name;
};

function renderList(body: HTMLElement, coder: ExternalCoding, render: () => void) {
  const codes = new Map(coder.codes.map((c) => [c.id, c]));
  let segs: Segment[];
  if (state.by === 'code') {
    segs = coder.segments.filter((s) => s.codeId === state.codeId || (state.subcodes && !!state.codeId && isCodeInSubtree(s.codeId, state.codeId, coder.codes)));
  } else {
    segs = coder.segments.filter((s) => s.docId === state.docId);
  }
  const items = segs
    .filter((s) => getDoc(s.docId) && codes.has(s.codeId))
    .filter((s) => !state.onlyChallenged || findChallenge(coder.coderName, s, codes.get(s.codeId)!, coder.codes));
  if (!items.length) {
    body.replaceChildren(h('p', { class: 'muted pad' }, state.onlyChallenged ? 'No challenged passages here.' : 'Nothing to review here.'));
    return;
  }
  const order = new Map(docsInTreeOrder().map((d, i) => [d.id, i]));
  items.sort((a, b) => (order.get(a.docId) ?? 0) - (order.get(b.docId) ?? 0) || a.start - b.start);

  const out: HTMLElement[] = [];
  let lastDoc = '';
  for (const s of items) {
    // By code, passages are grouped under their document.
    if (state.by === 'code' && s.docId !== lastDoc) {
      lastDoc = s.docId;
      out.push(h('div', { class: 'review-doc' }, docLabel(getDoc(s.docId)!)));
    }
    out.push(reviewItem(coder, s, codes.get(s.codeId)!, render));
  }
  const top = body.scrollTop;
  body.replaceChildren(...out);
  body.scrollTop = top;
}

function reviewItem(coder: ExternalCoding, s: Segment, code: Code, render: () => void): HTMLElement {
  const doc = getDoc(s.docId)!;
  const challenge = findChallenge(coder.coderName, s, code, coder.codes);
  const text = s.text.length > 600 ? `${s.text.slice(0, 600)}…` : s.text;
  return h(
    'div',
    { class: 'review-item' + (challenge ? ' challenged' : '') },
    h(
      'div',
      { class: 'review-item-head' },
      h('span', { class: 'swatch', style: { background: code.color } }),
      h('span', { class: 'review-code' }, codePath(code, coder.codes)),
      h('span', { class: 'muted' }, lineLabel(doc, s.start, s.end)),
      h('span', { class: 'grow' }),
      h(
        'button',
        {
          class: 'btn small',
          title: 'Show this passage in the document (with challenge mode on)',
          onClick: () => {
            setColumnVisible(coder.id, true);
            setChallengeMode(true);
            goToSegment(s.docId, s.start, s.end);
            window.focus();
          },
        },
        'Show',
      ),
      h(
        'button',
        {
          class: 'btn small' + (challenge ? '' : ' challenge-btn'),
          onClick: async () => {
            await challengeInteractive(coder.coderName, s, code, coder.codes);
            render();
          },
        },
        challenge ? '✎ Edit' : '⚑ Challenge',
      ),
    ),
    h('div', { class: 'review-text' }, text),
    challenge
      ? h(
          'div',
          { class: 'review-comment' },
          h('span', { class: 'challenge-mark' }, '⚑'),
          h('span', { class: 'grow' }, challenge.comment),
          h(
            'button',
            {
              class: 'icon-btn',
              title: 'Withdraw this challenge',
              onClick: () => {
                withdrawChallenge(challenge.id);
                render();
              },
            },
            '✕',
          ),
        )
      : null,
  );
}
