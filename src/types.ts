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
}

export interface UIState {
  selectedDocId: string | null;
  /** Target folder for new files and folders (null = top level). */
  selectedFolderId: string | null;
  collapsed: string[];
  /** External codings that are hidden in the comparison view. */
  hiddenExternal: string[];
  segmentsHidden: boolean;
}
