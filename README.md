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
- **Layout**: arrange the three areas (documents & codebook, text, coded segments) in any
  order by dragging their ⋮⋮ grip onto another area, and change the width of the side areas
  by dragging their inner edge. Drag the handles between *Documents*, *Codebook* and *Other
  coders* to change their heights. Double-click any handle to reset it. The theme button in the top bar switches between
  automatic (follows the system), light and dark.
- **Documents**: add `.txt` files with **+ Files** or by dropping them on the document list.
  Organise them in nested folders (**+ Folder**, or the ＋ on a folder). Drag documents and
  folders to move them. New files go into the selected folder.
- **Coding**: open a document and highlight a passage. A small box opens below the selection;
  type a code (existing codes are suggested) and press **Enter**. Pressing **Enter** without
  typing anything creates an *in-vivo code* from the highlighted words (or applies it, if a code
  with that name exists); **Tab** first puts the words into the box so you can shorten them. **Shift+Enter** applies the
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
  Type `?` or click **?** in the box for a short help on this syntax and the keys.
- **Memos**: start the text in the box with `memo:` (e.g. `memo: follow up in round 2`) to
  attach a memo to the passage instead of a code; `code:` forces a code (the default anyway).
  A badge in the box shows whether you are about to create a **Code** or a **Memo**. Memos
  appear as sticky notes in a *Memos* column next to the text (next to their passage; they can
  be moved and resized like the other columns) and in the side list, and their passages are
  underlined with dots. Click a sticky note to edit it (**Enter** saves, **Shift+Enter** adds a
  line, **Esc** cancels; emptying it deletes the memo). The table CSV export has a *Memos*
  column when a document has memos. Memos of other coders are imported with their coding and
  shown in their own read-only column.
- **View ▾** (above the text): switch all **Codes** (colors, brackets and list) or all **Memos**
  (sticky notes, underlines and list) on or off, and tick which columns to show: your codes and
  memos, the consolidated coding, and each other coder's codes and memos. The menu stays open
  while you tick boxes. Hidden columns are also left out of the table CSV export; the two
  switches only affect the screen.
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
- **Backups**: the top bar shows **● Not downloaded** while your latest changes exist only in
  this browser (click it to download the project zip) and **✓ Downloaded** with the time once a
  copy has them. Closing or reloading the tab with changes that were not downloaded triggers the
  browser's “Leave site?” confirmation; if you choose to stay, a dialog offers **Download copy**.
  (Browsers do not allow buttons in their own leave confirmation, hence the second step.)
- **Undo / redo**: the ↶/↷ buttons or ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y) undo any change to the
  project (last 50 steps, kept until the page is reloaded).
- **Export project** downloads the whole project as a `.zip`:
  - `project.json`: everything (folders, documents, codebook, your coding, other coders,
    consolidation). This is what gets imported again.
  - `documents/`: every text file in its folder structure.
  - `codebook.csv`: codes with colors, descriptions and counts.

  **Import ▾ → Project** replaces the current project with such a `.zip` (or a `.json` from older
  versions).
- **REFI-QDA (.qdpx)**, the open exchange standard supported by MAXQDA, NVivo, ATLAS.ti,
  QualCoder and others:
  - *Other formats ▾ → REFI-QDA project* exports all documents, the codebook (with hierarchy,
    colors and descriptions) and the coding of every coder as separate users. Other coders'
    codes are merged into one codebook by path; folders become sets named by their path.
  - *Import ▾ → REFI-QDA project* opens a `.qdpx` (in MAXQDA: *Home → Save Project As →
    REFI-QDA Project*). If several people coded it, you choose which one you are; everyone
    else appears under *Other coders*. Sets become folders (a document goes into its first
    set). Only text documents are imported; PDFs, images and media are skipped with a note.
  - *Other coder's coding* and *Codebook only* accept `.qdpx` files too.
  - Positions are converted between REFI-QDA's Unicode code points and this app, and
    Windows line endings in imported texts are handled, so passages stay exact.
- **Other formats ▾**
  - *Export table to CSV* (this document / all documents): one row per line of text with the
    columns `file, line, text` and then one column per coder, in the order of the comparison
    view. Each cell lists the codes on that line, separated by semicolons.
  - *Export segments to CSV*: one row per coded segment, for every coder.
- **Comparing coders**: choose **Import ▾ → Other coder's coding** in the top bar (or
  **＋ Compare with coder…** above the document, or *Other coders → Import…*) and pick another
  person's exported project. Their coding appears as an extra column next to the text; each additional coder gets
  another column. Documents are matched by identical text. Use the checkboxes to show or hide
  coders. Drag a column header, including the *Text* column's, to reorder columns; while the
  text is the first column it stays in view when scrolling sideways. Drag the right edge of any
  column to resize it (double-click the edge to reset).
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

The code follows the model–view–controller pattern. Dependencies point one way:
views read the model and send user actions to controllers; controllers update the model and
give feedback through the view; the model knows nothing about either. Every committed change
notifies `renderApp`, which re-renders the views.

| Folder / file | Purpose |
| --- | --- |
| `src/main.ts` | Entry point: wires the model's change notifications to the views |
| **`src/model/`** | Data and rules; no DOM rendering and no dialogs |
| `model/types.ts` | Data types (documents, folders, codes, segments, other coders, view state) |
| `model/state.ts` | The project and view state, persistence in `localStorage`, change notification, undo/redo |
| `model/parse.ts` | Creating and validating projects |
| `model/documents.ts` | Documents and folders |
| `model/codes.ts` | Codebook: codes, hierarchy, lookup by path, create/edit/merge/delete |
| `model/coding.ts`, `segmentOps.ts` | Applying codes to passages (including extending overlapping segments) |
| `model/layers.ts` | Which coding is active: yours or the open document's consolidation |
| `model/coders.ts` | Other people's imported coding |
| `model/memos.ts` | Memos (notes on passages) |
| `model/table.ts` | Which coder columns are shown, and their order |
| `model/consolidation.ts` | Per-document consolidation |
| `model/codebookEntries.ts` | The codebook in portable form (codebook import/export) |
| `model/lines.ts` | Line numbers from character offsets |
| `model/formats/` | File formats: project zip/json and codebook files, CSV, REFI-QDA (.qdpx) |
| **`src/controller/`** | User actions: ask and confirm, update the model, report the outcome |
| `controller/documents.ts` | Adding, moving, renaming and deleting documents and folders |
| `controller/codes.ts` | Codebook actions and the code details dialog's checks |
| `controller/coding.ts` | Reading what was typed in the code box (`memo:`, `code:`, `?`), coding passages |
| `controller/memos.ts` | Adding, editing and deleting memos |
| `controller/comparison.ts` | Other coders, consolidation, column order and widths |
| `controller/transfer.ts` | All imports and exports |
| `controller/preferences.ts`, `history.ts` | Coder name, theme, layout; undo/redo |
| **`src/view/`** | Rendering and DOM events |
| `view/app.ts` | Sets up all views and re-renders them |
| `view/document/` | The document area: text and highlights, coder and memo columns, code box, View menu |
| `view/tree.ts`, `codebookList.ts`, `codeDialog.ts`, `segmentList.ts`, `coderList.ts` | The panels and the code details dialog |
| `view/topbar.ts`, `welcome.ts` | Top bar, menus, keyboard shortcuts; first-use dialog |
| `view/leaveGuard.ts` | Warning before closing the tab, with an offer to download a copy |
| `view/layout.ts`, `splitters.ts` | Rearranging and resizing the main areas and sidebar panels |
| `view/dom.ts`, `feedback.ts`, `files.ts` | DOM helpers; messages and questions; file picking and downloads |
| `view/style.css` | Styles, including the light and dark themes |

Segments are stored as character offsets into the document text; line numbers are derived
from them. Colored highlights use the CSS Custom Highlight API (current Chrome, Edge, Safari
and Firefox).
