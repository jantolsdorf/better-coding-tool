// Code details: rename, recolor, describe, nest, merge, delete, and retrieve all coded segments.

import './codeDialog.css';
import {
  deleteCodeInteractive,
  goToSegment,
  mergeCodeInteractive,
  saveCodeDetails,
} from '../controller/codes';
import { codeById, codePath, isCodeInSubtree, subtreeOf } from '../model/codes';
import { folderPath, getDoc } from '../model/documents';
import { lineLabel } from '../model/lines';
import { project, subscribe } from '../model/state';
import { textBody } from './document/textView';
import { confirmAction, toast } from './feedback';
import { closeToolWindow, currentDocument, focusToolWindow, onEveryDocument, openToolWindow } from './windows';
import { codePicker, pickCode } from './codePicker';
import { h, hexToRgba } from './dom';

/** Where the pointer was pressed last (in which window): the code details open next to it. */
let lastPress: { x: number; y: number; doc: Document } | null = null;
onEveryDocument((doc) =>
  doc.addEventListener('pointerdown', (e) => (lastPress = { x: e.clientX, y: e.clientY, doc }), true),
);

/** Open code details dialogs (not in windows of their own), by code id. */
const openDialogs = new Map<string, HTMLDialogElement>();

/**
 * Places a floating dialog next to the point it was opened from: below it if it fits there, else
 * above it (else where there is more room), within the window.
 */
function placeNear(dlg: HTMLElement, at: { x: number; y: number } | null) {
  const win = dlg.ownerDocument.defaultView!;
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const w = dlg.offsetWidth;
  const hgt = dlg.offsetHeight;
  const gap = 12;
  const clamp = (v: number, max: number) => Math.max(8, Math.min(v, max - 8));
  if (!at) {
    dlg.style.left = `${clamp((vw - w) / 2, vw - w)}px`;
    dlg.style.top = `${clamp((vh - hgt) / 3, vh - hgt)}px`;
    return;
  }
  const below = vh - at.y - gap;
  const above = at.y - gap;
  const top = below >= hgt + 8 ? at.y + gap : above >= hgt + 8 ? at.y - gap - hgt : below >= above ? at.y + gap : at.y - gap - hgt;
  dlg.style.left = `${clamp(at.x - w / 2, vw - w)}px`;
  dlg.style.top = `${clamp(top, vh - hgt)}px`;
}

/** Lets a floating dialog be dragged by its header, within the window. */
function makeDraggable(dlg: HTMLElement, handle: HTMLElement) {
  handle.addEventListener('pointerdown', (e) => {
    // (Not once the details are in a window of their own.)
    if (!dlg.isConnected || e.button !== 0 || (e.target as Element).closest('button, input, select, textarea, a')) return;
    e.preventDefault();
    const win = dlg.ownerDocument.defaultView!;
    const start = { x: e.clientX, y: e.clientY, left: dlg.offsetLeft, top: dlg.offsetTop };
    const move = (ev: PointerEvent) => {
      const left = start.left + ev.clientX - start.x;
      const top = start.top + ev.clientY - start.y;
      // At least the header stays in the window, so it can always be dragged back.
      dlg.style.left = `${Math.max(8 - dlg.offsetWidth + 80, Math.min(left, win.innerWidth - 80))}px`;
      dlg.style.top = `${Math.max(0, Math.min(top, win.innerHeight - handle.offsetHeight))}px`;
    };
    const up = () => {
      win.removeEventListener('pointermove', move);
      win.removeEventListener('pointerup', up);
      dlg.classList.remove('dragging');
    };
    dlg.classList.add('dragging');
    win.addEventListener('pointermove', move);
    win.addEventListener('pointerup', up);
  });
}

/**
 * Opens the details of a code as a floating dialog in the window used last, next to where it was
 * clicked open; it can be dragged by its header, and the text behind it stays usable (e.g. to
 * see a coded segment). "Open in a separate window" moves the same dialog, with any unsaved
 * changes, into a window of its own (one per code; opening the code again brings that window, or
 * the open dialog, to the front). Everything changed in it is applied together by Save, as one
 * undo step, and the details stay open; "Close without saving" drops it (asking first, as Esc
 * does). Delete and Merge change the codebook at once, after asking.
 */
export function openCodeDialog(codeId: string) {
  const code = codeById(codeId);
  if (!code) return;
  const key = `code-${codeId}`;
  if (focusToolWindow(key)) return;
  // Already open: to the front.
  const already = openDialogs.get(codeId);
  if (already?.isConnected) {
    already.ownerDocument.body.append(already);
    already.querySelector<HTMLInputElement>('input')?.focus();
    return;
  }
  const dlg = h('dialog', { class: 'modal code-dialog floating' });
  openDialogs.set(codeId, dlg);
  let inWindow = false;
  // Closing through the dialog's own buttons (save, discard, delete, merge) never asks; closing
  // its window with unsaved changes does (see below).
  let closingOnPurpose = false;
  const close = () => {
    closingOnPurpose = true;
    if (inWindow) closeToolWindow(key);
    else dlg.close();
  };
  // The dialog closes by itself if the code disappears (e.g. deleted or merged elsewhere).
  const stop = subscribe(() => {
    if (!codeById(codeId)) close();
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (openDialogs.get(codeId) === dlg) openDialogs.delete(codeId);
    if (!inWindow) stop();
  });

  const nameInput = h('input', { type: 'text', class: 'field', value: code.name });
  const subcodeCount = subtreeOf(codeId).length - 1;
  // Saved with the rest (see save): the color also for all its subcodes. The button switches it
  // on and off; it shows the color they get.
  let colorSubcodes = false;
  const subcodeSwatch = h('span', { class: 'swatch', style: { background: code.color } });
  const subcodeColorBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small subcode-color',
      'aria-pressed': 'false',
      onClick: () => {
        colorSubcodes = !colorSubcodes;
        updateSubcodeColorBtn();
        refreshFoot();
      },
    },
    h('i', { class: 'fa-solid fa-check subcode-color-check', 'aria-hidden': 'true' }),
    subcodeSwatch,
    ` Apply color to ${subcodeCount} subcode${subcodeCount === 1 ? '' : 's'}`,
  );
  const updateSubcodeColorBtn = () => {
    subcodeColorBtn.setAttribute('aria-pressed', String(colorSubcodes));
    subcodeColorBtn.title = colorSubcodes
      ? 'Its subcodes get this color when you save. Click again to leave their colors as they are.'
      : 'Give all its subcodes this color too (when you save)';
  };
  updateSubcodeColorBtn();
  const colorInput = h('input', { type: 'color', class: 'swatch-input big', value: code.color });
  const desc = h('textarea', { class: 'field', rows: 3, placeholder: 'Definition / when to apply this code…' });
  desc.value = code.description ?? '';

  const segs = project.segments.filter((s) => s.codeId === codeId && getDoc(s.docId));
  const byDoc = new Map<string, typeof segs>();
  for (const s of segs) {
    if (!byDoc.has(s.docId)) byDoc.set(s.docId, []);
    byDoc.get(s.docId)!.push(s);
  }
  // Segments removed here are only deleted on Save; closing without saving keeps them.
  const removed = new Set<string>();
  const segLabel = h('label', { class: 'label' });
  const retrieval = h('div', { class: 'retrieval' });
  const expanded = new Set<string>();

  const renderSegments = () => {
    segLabel.textContent = `Coded segments (${segs.length - removed.size})` + (removed.size ? ` · ${removed.size} to be removed when you save` : '');
    retrieval.replaceChildren(
      ...[...byDoc].map(([docId, list]) => {
        const doc = getDoc(docId)!;
        const path = folderPath(doc.folderId);
        const left = list.filter((s) => !removed.has(s.id)).length;
        return h(
          'div',
          { class: 'retrieval-doc' },
          h('div', { class: 'retrieval-title' }, path ? `${path} / ${doc.name}` : doc.name, h('span', { class: 'badge' }, String(left))),
          ...list
            .sort((a, b) => a.start - b.start)
            .map((s) => {
              const gone = removed.has(s.id);
              const seg = h('div', {
                class: 'retrieval-seg' + (expanded.has(s.id) ? ' expanded' : '') + (gone ? ' removed' : ''),
                style: { borderLeftColor: code.color },
              });
              const jump = h(
                'button',
                {
                  class: 'seg-jump',
                  title: 'Show in document',
                  'aria-label': 'Show in document',
                  disabled: gone,
                  onClick: () => void showInDocument(doc.id, s.start, s.end, s.id),
                },
                h('i', { class: 'fa-solid fa-arrow-up-right-from-square', 'aria-hidden': 'true' }),
              );
              const toggleRemove = h(
                'button',
                {
                  class: 'seg-jump',
                  title: gone ? 'Keep this segment' : 'Remove this segment (when you save; can be undone)',
                  'aria-label': gone ? 'Keep segment' : 'Remove segment',
                  onClick: () => {
                    if (gone) removed.delete(s.id);
                    else removed.add(s.id);
                    renderSegments();
                    refreshFoot();
                  },
                },
                h('i', { class: gone ? 'fa-solid fa-rotate-left' : 'fa-solid fa-trash', 'aria-hidden': 'true' }),
              );
              const body = h(
                'button',
                {
                  class: 'seg-body',
                  style: { background: hexToRgba(code.color, 0.04) }
                },
                h('span', { class: 'seg-lines' }, lineLabel(doc, s.start, s.end), jump, toggleRemove),
                h('span', {
                  class: 'seg-text', title: expanded.has(s.id) ? 'Collapse segment' : 'Show full segment',
                  'aria-expanded': String(expanded.has(s.id)),
                  onClick: () => {
                    if (expanded.has(s.id)) expanded.delete(s.id);
                    else expanded.add(s.id);
                    renderSegments();
                  },
                }, s.text),
              );              
              seg.append(body);
              return seg;
            }),
        );
      }),
    );
  };
  renderSegments();

  const others = project.codes.filter((c) => c.id !== codeId);
  // A code can be nested under any code outside its own subtree (found as when coding, shown as a tree).
  const parentPicker = codePicker({
    value: code.parentId ?? null,
    topLevel: '(top level)',
    allow: (c) => !isCodeInSubtree(c.id, codeId),
    onPick: () => {
      updateHead();
      refreshFoot();
    },
  });
  const parentId = () => parentPicker.value() ?? null;

  /** Saves everything changed; the details stay open, with what is saved now. */
  const save = () => {
    const saved = saveCodeDetails(codeId, {
      name: nameInput.value,
      color: colorInput.value,
      description: desc.value,
      parentId: parentId(),
      colorSubcodes,
    }, [...removed]);
    if (!saved) return false;
    // What is shown is now the saved state.
    initial = current();
    colorSubcodes = false;
    updateSubcodeColorBtn();
    for (let i = segs.length - 1; i >= 0; i--) if (removed.has(segs[i].id)) segs.splice(i, 1);
    for (const [docId, list] of byDoc) {
      const left = list.filter((x) => !removed.has(x.id));
      if (left.length) byDoc.set(docId, left);
      else byDoc.delete(docId);
    }
    removed.clear();
    renderSegments();
    refreshFoot();
    toast('Saved.');
    return true;
  };

  // Closing: just "Close" while nothing is changed; else closing without saving (asks first), or
  // saving, which keeps the details open (see refreshFoot).
  const closeArea = h('span', { class: 'code-dialog-close' });
  const popoutBtn = h('button', { type: 'button', class: 'icon-btn popout-btn', title: 'Open in a separate window (keeps your changes)', 'aria-label': 'Open in a separate window', onClick: () => openInWindow() }, '⧉');
  // The header names the code by its path, as it will be after saving (name, parent, color).
  const headSwatch = h('span', { class: 'swatch', style: { background: code.color } });
  const headParents = h('span', { class: 'muted' });
  const headName = h('strong', {});
  const updateHead = () => {
    const parent = parentId() ? codeById(parentId()!) : undefined;
    headParents.textContent = parent ? `${codePath(parent)} › ` : '';
    headName.textContent = nameInput.value.trim() || code.name;
    headSwatch.style.background = colorInput.value;
    subcodeSwatch.style.background = colorInput.value;
  };
  updateHead();
  const inner = h(
    'div',
    { class: 'modal-inner' },
    h(
      'div',
      { class: 'modal-head' },
      headSwatch,
      h('span', { class: 'code-dialog-title grow', title: 'Code details' }, headParents, headName),
      popoutBtn,
    ),
    h(
      'div',
      { class: 'modal-body' },
      h('div', { class: 'row' }, h('label', { class: 'label' }, 'Color'), h('label', { class: 'label' }, 'Name')),
      h('div', { class: 'row' }, colorInput, nameInput),
      subcodeCount ? h('div', {}, subcodeColorBtn) : null,
      h('label', { class: 'label' }, 'Parent code'),
      parentPicker.el,
      h('label', { class: 'label' }, 'Description'),
      desc,
      segLabel,
      segs.length ? retrieval : h('p', { class: 'muted' }, 'This code has not been applied yet.'),
    ),
    // Left: actions that change the codebook at once (each asks first); right: closing, with or
    // without saving what was changed above.
    h(
      'div',
      { class: 'modal-foot' },
      h(
        'button',
        {
          class: 'btn danger icon-label',
          title: 'Delete this code (asks first; your changes here are not saved)',
          onClick: async () => {
            if (await deleteCodeInteractive(code, segs.length)) close();
          },
        },
        h('i', { class: 'fa-solid fa-trash', 'aria-hidden': 'true' }),
        'Delete code…',
      ),
      others.length
        ? h(
            'button',
            {
              class: 'btn icon-label',
              title: 'Merge this code into another code: choose it, see what happens, then confirm',
              onClick: async () => {
                const target = await pickCode(
                  inner.ownerDocument,
                  `Merge “${code.name}” into…`,
                  'Choose the code that gets its coded segments and subcodes. You see what happens before anything changes.',
                  { allow: (c) => c.id !== codeId },
                );
                if (target && (await mergeCodeInteractive(code, target))) close();
              },
            },
            h('i', { class: 'fa-solid fa-code-merge', 'aria-hidden': 'true' }),
            'Merge into…',
          )
        : null,
      h('span', { class: 'grow' }),
      closeArea,
    ),
  );
  nameInput.addEventListener('input', updateHead);
  colorInput.addEventListener('input', updateHead);

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
  // Unsaved: anything changed since the dialog opened (or was last saved).
  const current = () => ({ name: nameInput.value, color: colorInput.value, desc: desc.value, parent: parentId() });
  let initial = current();
  const unsaved = () =>
    nameInput.value !== initial.name ||
    colorInput.value !== initial.color ||
    desc.value !== initial.desc ||
    parentId() !== initial.parent ||
    colorSubcodes ||
    removed.size > 0;
  const requestClose = async () => {
    if (!unsaved()) return close();
    const discard = await confirmAction('Your changes to this code are lost.', { title: 'Close without saving?', confirm: 'Close without saving', cancel: 'Keep editing', danger: true });
    if (discard) close();
  };

  /** The closing buttons, for whether anything is changed (redrawn only when that changes). */
  let shownUnsaved: boolean | undefined;
  function refreshFoot() {
    const changed = unsaved();
    if (changed === shownUnsaved) return;
    shownUnsaved = changed;
    if (!changed) {
      closeArea.replaceChildren(h('button', { class: 'btn', title: 'Close (Esc)', onClick: close }, 'Close'));
      return;
    }
    closeArea.replaceChildren(
      h('button', { class: 'btn', title: 'Close and drop your changes (asks first; Esc too)', onClick: () => void requestClose() }, 'Close without saving…'),
      h('button', { class: 'btn primary', title: 'Save your changes; the details stay open (Enter in the name field)', onClick: () => save() }, 'Save'),
    );
  }
  inner.addEventListener('input', refreshFoot);
  inner.addEventListener('change', refreshFoot);
  refreshFoot();

  // As a modal: Esc asks before dropping changes (handled here, so the dialog does not just close).
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    void requestClose();
  });

  /** Moves the dialog, as it is, into a window of its own. */
  function openInWindow() {
    const root = openToolWindow(key, `Code: ${code!.name}`, () => stop(), { width: 720, height: 820 });
    if (!root) return;
    inWindow = true;
    popoutBtn.remove();
    inner.classList.add('tool-inner');
    root.append(inner);
    dlg.close();
    const doc = root.ownerDocument;
    // Closing the window itself (or the app) with unsaved changes: the browser asks first.
    doc.defaultView!.addEventListener('beforeunload', (e) => {
      if (closingOnPurpose || !unsaved()) return;
      e.preventDefault();
      e.returnValue = '';
    });
    // Esc discards, as in the dialog (unless a dialog inside the window is open).
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !doc.querySelector('dialog[open]')) void requestClose();
    });
    nameInput.focus();
  }

  /** Shows a segment in the text; the code details stay open (they can be moved aside). */
  async function showInDocument(docId: string, start: number, end: number, segId: string) {
    const textDoc = textBody.ownerDocument;
    goToSegment(docId, start, end, segId);
    if (textDoc === inner.ownerDocument) return;
    // The text may be in the main window or in its own window. A page cannot bring back a
    // minimized window, so say where the passage is shown.
    if (textDoc.visibilityState === 'hidden') {
      toast('The passage is now shown in the window with the text, but that window is minimized. Bring it back to see it.', 6000);
    } else textDoc.defaultView?.focus();
  }

  dlg.append(inner);
  const doc = currentDocument();
  doc.body.append(dlg);
  // Not modal: the text behind it stays usable.
  dlg.show();
  placeNear(dlg, lastPress?.doc === doc ? lastPress : null);
  makeDraggable(dlg, inner.querySelector<HTMLElement>('.modal-head')!);
  nameInput.focus();
}
