# Better Coding Tool

A small browser-based tool for qualitative coding of text documents such as interview transcripts.
It needs no server: everything is stored in the browser's `localStorage`.

## Running

```bash
npm install
npm run dev        # development server at http://localhost:5173
npm run build      # produces a single self-contained dist/index.html
```

`dist/index.html` can be opened directly from disk or shared with colleagues. Note that
`localStorage` is per browser and per origin, so export your project to back it up or move it.

## Features

- **Getting started**: on first use the tool asks for your name. It labels your coding in
  exports and in other people's comparison view; change it any time in the top bar. When you
  open a project coded under another name, you're asked who continues coding it.
- **Layout**: drag the handles between *Documents*, *Codebook* and *Other coders* to change
  their heights (double-click to reset). The theme button in the top bar switches between
  automatic (follows the system), light and dark.
- **Documents**: add `.txt` files with **+ Files** or by dropping them on the document list.
  Organise them in nested folders (**+ Folder**, or the ＋ on a folder). Drag documents and
  folders to move them. New files go into the selected folder.
- **Coding**: open a document and highlight a passage. A small box opens below the selection;
  type a code (existing codes are suggested) and press **Enter**. **Shift+Enter** applies the
  code and keeps the box open to add more codes to the same passage. **↑/↓** chooses a
  suggestion, **Tab** completes it, **Esc** cancels.
  Type `Level 1 code > Level 2 code` (more levels work too, and `›` is accepted) to create a
  subcode. Missing parent codes are created on the way, and new subcodes take the color of the
  level 1 code. Code names only need to be unique among codes with the same parent, so
  `Trust > Coping` is a new code even if a top-level `Coping` exists. Suggestions match names
  (`dist`) and paths (`trust > dist`); `trust >` lists Trust's subcodes. Typing just a
  subcode's name still suggests it.
  If the passage overlaps a segment that already has the same code, no new segment is created:
  the existing segment is extended to cover both.
- **Display**: coded passages are highlighted in the code's color. The column next to the text
  shows a bracket per segment spanning its first to last line; the right panel lists each
  segment with its line range (e.g. `L6–L8`) and text. Hover to highlight, click to jump.
- **Codebook**: change a code's color with its swatch; click its name to rename it, add a
  description, set its parent code, see every segment coded with it across all documents,
  merge it into another code, or delete it.
  - **Hierarchy**: drag a code onto another code. The target shows two options: **⤷ Subcode**
    (nests it, no confirmation) and **⇢ Merge** (moves all its segments and subcodes into the
    target after confirmation). Drop on *Drop here to move to the top level* to un-nest.
    Counts read “own · including subcodes”.
  - **Display**: *Indented* shows subcodes indented under their parents; *A > B* shows a flat
    list of full paths such as `Trust > Distrust`.
  - **Filter and sort**: type in *Filter codes…* to show only matching codes, by name,
    description or path (`trust > dist`). In the indented view their parent codes stay
    visible, greyed, for context; Esc clears. Sort by *A–Z* or *Last edited* (the
    most recently created, changed, moved or applied codes first; a parent sorts by its most
    recently edited subcode).
  - **⋯ menu**: export the codebook only (JSON, re-importable, or CSV), or import a codebook.
    Importing accepts a codebook file or any exported project and only adds codes (matched by
    path, i.e. name and position); you can choose whether existing codes take the imported color
    and description. Consolidation matches other coders' codes by path in the same way.
- **Undo / redo**: the ↶/↷ buttons or ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y) undo any change to the
  project (last 50 steps, kept until the page is reloaded).
- **Export project** downloads the whole project as a `.zip`:
  - `project.json`: everything (folders, documents, codebook, your coding, other coders,
    consolidation). This is what gets imported again.
  - `documents/`: every text file in its folder structure.
  - `codebook.csv`: codes with colors, descriptions and counts.

  **Import ▾ → Project** replaces the current project with such a `.zip` (or a `.json` from older
  versions).
- **Export CSV ▾**
  - *Export table to CSV* (this document / all documents): one row per line of text with the
    columns `file, line, text` and then one column per coder, in the order of the comparison
    view. Each cell lists the codes on that line, separated by semicolons.
  - *Export segments to CSV*: one row per coded segment, for every coder.
- **Comparing coders**: choose **Import ▾ → Other coder's coding** in the top bar (or
  **＋ Compare with coder…** above the document, or *Other coders → Import…*) and pick another
  person's exported project. Their coding appears as an extra column next to the text; each additional coder gets
  another column. Documents are matched by identical text. Use the checkboxes to show or hide
  coders. Drag a column header to reorder columns; drag the right edge of any column, including
  the text column, to resize it (double-click the edge to reset).
- **Consolidating** works per document. **Start consolidation** adds a *Consolidated* column
  for the open document only; documents with a consolidation in progress are marked
  *consolidating* in the document list. Hover a segment in any coder's column and click **＋**
  to accept it (✓ marks accepted ones), or use **⇉ All** in a column header to accept all of
  that coder's segments in the document. In a document being consolidated, new codes go into
  the consolidated coding (switch with *Code into* in the code box), so you can also add or
  re-cut segments directly; in all other documents you keep coding as usual. **✓ Finish**
  makes the consolidated coding your coding of that document and keeps your previous coding of
  it under *Other coders* as “… (before consolidation)”; **✕** discards that document's
  consolidation. Other documents are never changed.

## Code layout

| File | Purpose |
| --- | --- |
| `src/types.ts` | Data model (documents, folders, codes, segments, other coders) |
| `src/store.ts` | State, persistence to `localStorage`, all mutations |
| `src/viewer.ts` | Document view, text selection, code box, highlights, coder columns |
| `src/tree.ts` | Document/folder tree with drag & drop |
| `src/codebook.ts` | Codebook list and code details dialog |
| `src/segments.ts` | Coded segments panel |
| `src/coders.ts` | Other coders panel |
| `src/io.ts` | JSON/CSV export and import |

Segments are stored as character offsets into the document text; line numbers are derived
from them. Colored highlights use the CSS Custom Highlight API (current Chrome, Edge, Safari
and Firefox).
