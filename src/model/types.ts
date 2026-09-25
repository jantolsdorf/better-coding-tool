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
  /** When the code was last created, changed or applied (ISO date). */
  updatedAt?: string;
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

/** A note attached to a passage of text, shown as a sticky note. */
export interface Memo {
  id: string;
  docId: string;
  /** Character offsets into Doc.content, end exclusive. */
  start: number;
  end: number;
  /** The passage the memo is attached to. */
  text: string;
  /** The memo itself. */
  note: string;
  createdAt: string;
  updatedAt?: string;
}

/** The coding of another person, imported for side-by-side comparison. */
export interface ExternalCoding {
  id: string;
  coderName: string;
  codes: Code[];
  segments: Segment[];
  /** Their memos (read-only here). */
  memos: Memo[];
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
  /** Your memos (notes on passages). */
  memos: Memo[];
  externalCodings: ExternalCoding[];
  /**
   * Agreed codings built from all coders, one per document being consolidated (keyed by
   * document id; a document without an entry is not being consolidated). They use the same
   * codebook as Project.codes.
   */
  consolidations: Record<string, Segment[]>;
}

/** 'me', 'consolidated', or the id of an ExternalCoding. */
export type ColumnKey = string;

/** A column of sticky notes: your memos or another coder's (read-only). */
export interface MemoColumn {
  key: ColumnKey;
  name: string;
  mine: boolean;
  memos: Memo[];
}

export interface TableColumn {
  key: ColumnKey;
  kind: 'mine' | 'consolidated' | 'external';
  name: string;
  codes: Code[];
  segments: Segment[];
}

export type MainArea = 'sidebar' | 'viewer' | 'segments';

export interface UIState {
  selectedDocId: string | null;
  /** Target folder for new files and folders (null = top level). */
  selectedFolderId: string | null;
  collapsed: string[];
  /** Columns hidden in the comparison view (coder columns, memo columns, Consolidated). */
  hiddenColumns: ColumnKey[];
  /** Master switches: show codes (highlights, brackets, list) and memos (notes, underlines, list). */
  showCodes: boolean;
  showMemos: boolean;
  /** Color the coded passages in the text (off: they are highlighted only while hovering a code). */
  colorText: boolean;
  segmentsHidden: boolean;
  /** Order of the coder columns in the comparison view. */
  columnOrder: ColumnKey[];
  columnWidths: Record<ColumnKey, number>;
  /** Width of the text column in px (null = automatic). */
  textWidth: number | null;
  collapsedCodes: string[];
  codeSort: 'name' | 'recent';
  /** Codebook as an indented tree, or as a flat list of "Parent > Child" paths. */
  codeView: 'tree' | 'path';
  theme: 'auto' | 'light' | 'dark';
  /** Relative heights of the sidebar panels (documents, codebook, other coders); null = default. */
  panelFlex: number[] | null;
  /** Left-to-right order of the main areas, and the widths of the side areas (null = default). */
  mainOrder: MainArea[];
  sidebarWidth: number | null;
  segmentsWidth: number | null;
  /** Which coding new codes go into while a consolidation is in progress. */
  codeTarget: 'mine' | 'consolidated';
  /** Whether the help section of the code box is open. */
  codeBoxHelp: boolean;
  /** Fingerprint and time of the project when a copy was last downloaded (or opened from a file). */
  backedUp: { fingerprint: string; at: string } | null;
}
