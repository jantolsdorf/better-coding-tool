// Which coding is "active": yours, or the open document's consolidated coding.

import { project, ui } from './state';
import type { Segment } from './types';

/** The consolidation in progress for a document, if any. */
export const consolidationOf = (docId: string | null | undefined): Segment[] | undefined =>
  docId ? project.consolidations[docId] : undefined;

/** All consolidated segments, of every document being consolidated. */
export const allConsolidated = (): Segment[] => Object.values(project.consolidations).flat();

/**
 * The coding that new codes go into and that is highlighted in the text: yours, or the open
 * document's consolidated coding while it is being consolidated.
 */
export function activeLayer(): 'mine' | 'consolidated' {
  return consolidationOf(ui.selectedDocId) && ui.codeTarget === 'consolidated' ? 'consolidated' : 'mine';
}

export function layerSegments(layer = activeLayer(), docId = ui.selectedDocId): Segment[] {
  return layer === 'consolidated' ? (consolidationOf(docId) ?? []) : project.segments;
}
