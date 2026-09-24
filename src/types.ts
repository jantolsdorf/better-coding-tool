export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface Doc {
  id: string;
  name: string;
  folderId: string | null;
  /** Normalized text (\n line endings). Segment offsets index into this string. */
  content: string;
  addedAt: string;
}

export interface Code {
  id: string;
  name: string;
  color: string;
  description?: string;
  /** Parent code in the code hierarchy (null/undefined = top level). */
  parentId?: string | null;
}

export interface Segment {
  id: string;
  docId: string;
  codeId: string;
  /** Character offsets into Doc.content, end exclusive. */
  start: number;
  end: number;
  text: string;
  createdAt: string;
  /** For consolidated segments: whose coding it was accepted from. */
  source?: string;
}

/** The coding of another person, imported for side-by-side comparison. */
export interface ExternalCoding {
  id: string;
  coderName: string;
  codes: Code[];
  segments: Segment[];
  importedAt: string;
}

export interface Project {
  format: 'bct-project';
  version: 1;
  coderName: string;
  folders: Folder[];
  docs: Doc[];
  codes: Code[];
  segments: Segment[];
  externalCodings: ExternalCoding[];
  /**
   * The agreed coding built from all coders during consolidation (null = not started).
   * Uses the same codebook as Project.codes.
   */
  consolidated: Segment[] | null;
}

/** 'me', 'consolidated', or the id of an ExternalCoding. */
export type ColumnKey = string;

export interface TableColumn {
  key: ColumnKey;
  kind: 'mine' | 'consolidated' | 'external';
  name: string;
  codes: Code[];
  segments: Segment[];
}

export interface UIState {
  selectedDocId: string | null;
  /** Target folder for new files and folders (null = top level). */
  selectedFolderId: string | null;
  collapsed: string[];
  /** External codings that are hidden in the comparison view. */
  hiddenExternal: string[];
  segmentsHidden: boolean;
  /** Order of the coder columns in the comparison view. */
  columnOrder: ColumnKey[];
  columnWidths: Record<ColumnKey, number>;
  /** Width of the text column in px (null = automatic). */
  textWidth: number | null;
  collapsedCodes: string[];
  /** Which coding new codes go into while a consolidation is in progress. */
  codeTarget: 'mine' | 'consolidated';
}
