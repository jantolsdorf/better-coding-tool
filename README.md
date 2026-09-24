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

- **Documents**: add `.txt` files with **+ Files** or by dropping them on the document list.
  Organise them in nested folders (**+ Folder**, or the ＋ on a folder). Drag documents and
  folders to move them. New files go into the selected folder.
- **Coding**: open a document and highlight a passage. A small box opens below the selection;
  type a code (existing codes are suggested) and press **Enter**. **Shift+Enter** applies the
  code and keeps the box open to add more codes to the same passage. **↑/↓** chooses a
  suggestion, **Tab** completes it, **Esc** cancels.
- **Display**: coded passages are highlighted in the code's color. The column next to the text
  shows a bracket per segment spanning its first to last line; the right panel lists each
  segment with its line range (e.g. `L6–L8`) and text. Hover to highlight, click to jump.
- **Codebook**: change a code's color with its swatch; click its name to rename it, add a
  description, see every segment coded with it across all documents, merge it into another
  code, or delete it.
- **Export project** downloads the whole project as a `.zip`:
  - `project.json`: everything (folders, documents, codebook, your coding, other coders,
    consolidation). This is what gets imported again.
  - `documents/`: every text file in its folder structure.
  - `codebook.csv`: codes with colors, descriptions and counts.

  **Import project** replaces the current project with such a `.zip` (or a `.json` from older
  versions).
- **Export CSV ▾**
  - *Export table to CSV* (this document / all documents): one row per line of text with the
    columns `file, line, text` and then one column per coder, in the order of the comparison
    view. Each cell lists the codes on that line, separated by semicolons.
  - *Export segments to CSV*: one row per coded segment, for every coder.
- **Comparing coders**: under **Other coders → Import…**, choose another person's exported
  project. Their coding appears as an extra column next to the text; each additional coder gets
  another column. Documents are matched by identical text. Use the checkboxes to show or hide
  coders. Drag a column header to reorder columns; drag a column's right edge to resize it.
- **Consolidating**: **Start consolidation** adds a *Consolidated* column. Hover a segment in
  any coder's column and click **＋** to accept it (✓ marks accepted ones), or use **⇉ All** in a
  column header to accept all of that coder's segments in the document. While consolidating,
  new codes go into the consolidated coding (switch with *Code into* in the code box), so you
  can also add or re-cut segments directly. **✓ Finish** makes the consolidated coding your
  coding and keeps your previous coding under *Other coders* as “… (before consolidation)”;
  **✕** discards the consolidation.

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
