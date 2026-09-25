// User actions in the comparison view: other coders, consolidation, and the column layout.

import { codePathParts } from '../model/codes';
import { removeExternal, renameExternal } from '../model/coders';
import {
  acceptIntoConsolidated,
  discardConsolidation,
  finishConsolidation,
  startConsolidation,
  type AcceptItem,
} from '../model/consolidation';
import { commitUI, ui } from '../model/state';
import { CONSOLIDATED_KEY, reorderedColumns } from '../model/table';
import type { Code, ColumnKey, Doc, ExternalCoding, Segment, TableColumn } from '../model/types';
import { ask, confirmAction, toast } from '../view/feedback';

// ---------- other coders ----------

export function renameCoderInteractive(x: ExternalCoding) {
  const name = ask('Coder name:', x.coderName);
  if (name?.trim()) renameExternal(x.id, name);
}

export function removeCoderInteractive(x: ExternalCoding) {
  if (confirmAction(`Remove the imported coding of “${x.coderName}”?`)) removeExternal(x.id);
}

/** Shows or hides a column next to the text (a coder's codes or memos, or the consolidated coding). */
export function setColumnVisible(key: ColumnKey, visible: boolean) {
  ui.hiddenColumns = ui.hiddenColumns.filter((k) => k !== key);
  if (!visible) ui.hiddenColumns.push(key);
  commitUI();
}

/** Master switch for all codes on screen: highlights, brackets and code cards. */
export function setCodesShown(shown: boolean) {
  ui.showCodes = shown;
  commitUI();
}

/** Whether coded passages are colored in the text, or only highlighted while their code is hovered. */
export function setTextColored(colored: boolean) {
  ui.colorText = colored;
  commitUI();
}

/** Master switch for all memos on screen: sticky notes, underlines and memo cards. */
export function setMemosShown(shown: boolean) {
  ui.showMemos = shown;
  commitUI();
}

// ---------- consolidation ----------

export function startConsolidationOf(doc: Doc) {
  // New codes go into the consolidated coding, and its column starts next to the text.
  ui.codeTarget = 'consolidated';
  ui.columnOrder = ui.columnOrder.filter((k) => k !== CONSOLIDATED_KEY);
  startConsolidation(doc.id);
}

export function finishConsolidationInteractive(doc: Doc) {
  const ok = confirmAction(
    `Finish the consolidation of “${doc.name}”?\n\nThe consolidated coding becomes your coding of this document. ` +
      'Your current coding of it is kept under “Other coders” so you can still compare against it. Other documents are not changed.',
  );
  if (!ok) return;
  const res = finishConsolidation(doc.id);
  if (!res) return;
  // The kept coding is for reference; it starts hidden so it does not crowd the table.
  if (res.created) setColumnVisible(res.keptAs.id, false);
  toast(`Done. Your previous coding of this document is kept as “${res.keptAs.coderName}”.`, 5000);
}

export function discardConsolidationInteractive(doc: Doc) {
  if (confirmAction(`Discard the consolidated coding of “${doc.name}”? Your own coding is not changed.`)) discardConsolidation(doc.id);
}

/** A segment of a coder's column, with its code identified by path in that coder's codebook. */
function acceptItem(col: TableColumn, seg: Segment, code: Code): AcceptItem {
  return { seg, path: codePathParts(code, col.codes), color: code.color, source: col.name };
}

export function acceptSegment(col: TableColumn, seg: Segment, code: Code) {
  acceptIntoConsolidated([acceptItem(col, seg, code)]);
}

/** Accepts all of a coder's segments in a document into its consolidated coding. */
export function acceptAllSegments(col: TableColumn, segs: Segment[], codes: Map<string, Code>) {
  const items = segs.flatMap((seg) => {
    const code = codes.get(seg.codeId);
    return code ? [acceptItem(col, seg, code)] : [];
  });
  const n = acceptIntoConsolidated(items);
  toast(n ? `Accepted ${n} segment${n === 1 ? '' : 's'} from ${col.name}.` : 'Nothing new to accept.');
}

// ---------- column layout ----------

/** Moves a column (a coder column or the text column) directly before or after another. */
export function moveColumn(key: ColumnKey, target: ColumnKey, after: boolean) {
  const order = reorderedColumns(key, target, after);
  if (!order) return;
  ui.columnOrder = order;
  commitUI();
}

/** Sets a coder column's width in px (null = default width). */
export function setColumnWidth(key: ColumnKey, width: number | null) {
  if (width) ui.columnWidths[key] = Math.round(width);
  else delete ui.columnWidths[key];
  commitUI();
}

/** Sets the text column's width in px (null = automatic). */
export function setTextWidth(width: number | null) {
  ui.textWidth = width && Math.round(width);
  commitUI();
}

/** Shows or hides the list of coded segments next to the document. */
export function setSegmentListShown(shown: boolean) {
  ui.segmentsHidden = !shown;
  commitUI();
}
