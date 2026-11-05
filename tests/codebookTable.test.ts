import { beforeEach, describe, expect, it } from 'vitest';
import { applyRowEdits, codebookRows, reorderAsRows, rowParentCode, tableLevels, type RowEdit } from '../src/model/codebookTable';
import { codeForPath, findCodeByPath } from '../src/model/codes';
import { commit, project, ui, undo } from '../src/model/state';
import { freshProject } from './helpers';

const paths = () => codebookRows().map((r) => r.path.join(' > '));
/** The row of a code as the table shows it, ready to edit. */
const rowOf = (path: string): RowEdit => {
  const r = codebookRows().find((x) => x.path.join(' > ') === path)!;
  return { ids: [...r.ids], path: [...r.path], oldPath: [...r.path], descriptions: [...r.descriptions], oldDescriptions: [...r.descriptions] };
};
const id = (p: string) => findCodeByPath(p.split(' > '))!.id;

beforeEach(() => {
  freshProject();
  codeForPath('Rules > Workarounds', '#ef4444').description = 'Ways around rules';
  codeForPath('Rules > Complaints');
  codeForPath('Trust', '#3b82f6');
  commit();
  ui.codeSort = 'name';
});

describe('codebookRows', () => {
  it('has one row per code without subcodes, with its parents’ names, colors, descriptions and counts', () => {
    expect(paths()).toEqual(['Rules > Complaints', 'Rules > Workarounds', 'Trust']);
    ui.codeSort = 'custom';
    expect(paths()).toEqual(['Rules > Workarounds', 'Rules > Complaints', 'Trust']);
    const row = codebookRows()[0];
    expect(row.ids).toEqual([id('Rules'), id('Rules > Workarounds')]);
    expect(row.colors).toEqual(['#ef4444', '#ef4444']);
    expect(row.descriptions).toEqual(['', 'Ways around rules']);
    expect(row.segments).toEqual([0, 0]);
    expect(tableLevels()).toBe(2);
  });
});

describe('applyRowEdits', () => {
  it('renames the code of an edited level cell, also a parent from a subcode’s row, as one undo step', () => {
    const e = rowOf('Rules > Workarounds');
    e.path = ['Regeln', 'Workarounds'];
    expect(applyRowEdits([e])).toEqual({ changed: 1, problems: [] });
    expect(paths()).toEqual(['Regeln > Complaints', 'Regeln > Workarounds', 'Trust']);
    undo();
    expect(paths()[0]).toBe('Rules > Complaints');
  });

  it('applies each description cell to the code at its level', () => {
    const e = rowOf('Rules > Workarounds');
    e.descriptions = ['Everything about rules', 'Ways around the rules'];
    applyRowEdits([e]);
    expect(findCodeByPath(['Rules'])?.description).toBe('Everything about rules');
    expect(findCodeByPath(['Rules', 'Workarounds'])?.description).toBe('Ways around the rules');
  });

  it('applies only changed cells, so rows of a pasted block do not undo each other', () => {
    const a = rowOf('Rules > Complaints');
    const b = rowOf('Rules > Workarounds');
    a.path = ['Regeln', 'Complaints'];
    b.descriptions[1] = 'Changed';
    applyRowEdits([a, b]);
    expect(findCodeByPath(['Regeln', 'Workarounds'])?.description).toBe('Changed');
  });

  it('creates subcodes typed into the free levels after a row’s code', () => {
    const e = rowOf('Trust');
    e.path = ['Trust', 'Distrust'];
    e.descriptions[1] = 'Not trusting';
    applyRowEdits([e]);
    expect(findCodeByPath(['Trust', 'Distrust'])?.description).toBe('Not trusting');
    expect(paths()).toEqual(['Rules > Complaints', 'Rules > Workarounds', 'Trust > Distrust']);
  });

  it('creates codes from new rows under the parents they name, creating missing ones', () => {
    applyRowEdits([{ ids: [], path: ['Feelings', 'Fear'], descriptions: ['Emotions', 'Being afraid'] }]);
    expect(findCodeByPath(['Feelings'])?.description).toBe('Emotions');
    expect(findCodeByPath(['Feelings', 'Fear'])?.description).toBe('Being afraid');
    applyRowEdits([{ ids: [], path: ['rules', 'Rule breaking'], descriptions: [] }]);
    expect(paths()).toContain('Rules > Rule breaking');
  });

  it('names a copied code without subcodes "name (2)", and keeps the name only for an explicitly new code', () => {
    applyRowEdits([{ ids: [], path: ['Rules', 'Workarounds'], descriptions: [] }]);
    expect(paths()).toContain('Rules > Workarounds (2)');
    applyRowEdits([{ ids: [], path: ['Rules', 'Workarounds'], descriptions: [] }]);
    expect(paths()).toContain('Rules > Workarounds (3)');
    applyRowEdits([{ ids: [], path: ['Rules', 'Workarounds'], choices: [undefined, { new: true }], descriptions: [] }]);
    expect(paths().filter((p) => p === 'Rules > Workarounds')).toHaveLength(2);
    const e = rowOf('Rules > Complaints');
    e.path = ['Rules', 'Workarounds (2)'];
    applyRowEdits([e]);
    expect(paths()).toContain('Rules > Workarounds (4)');
  });

  it('puts a row under the code whose name is pasted or filled into a parent cell (the same code, not a new one)', () => {
    applyRowEdits([{ ids: [], path: ['Feelings', 'Fear'], descriptions: [] }]);
    const e = rowOf('Rules > Workarounds');
    e.path = ['Feelings', 'Workarounds'];
    applyRowEdits([e]);
    expect(paths()).toEqual(['Feelings > Fear', 'Feelings > Workarounds', 'Rules > Complaints', 'Trust']);
    expect(project.codes.filter((c) => c.name === 'Feelings')).toHaveLength(1);
  });

  it('makes a code a subcode of the parent code whose name is filled into its own cell', () => {
    const e = rowOf('Trust');
    e.path = ['Rules'];
    applyRowEdits([e]);
    expect(paths()).toEqual(['Rules > Complaints', 'Rules > Trust', 'Rules > Workarounds']);
  });

  it('edits a code with several empty levels after it (a table deeper than its row)', () => {
    // The table gives every row a cell per level: here two empty ones after "Trust".
    const e = { ...rowOf('Trust'), path: ['Belief', '', ''], oldPath: ['Trust', '', ''] };
    expect(applyRowEdits([e])).toEqual({ changed: 1, problems: [] });
    expect(paths()).toContain('Belief');
    const f = { ...rowOf('Belief'), path: ['Rules', '', ''], oldPath: ['Belief', '', ''] };
    expect(applyRowEdits([f]).problems).toEqual([]);
    expect(paths()).toContain('Rules > Belief');
  });

  it('reports a subcode typed after an empty level', () => {
    const e = { ...rowOf('Trust'), path: ['Trust', '', 'Deep'], oldPath: ['Trust', '', ''] };
    expect(applyRowEdits([e]).problems).toEqual([{ edit: 0, message: 'Type the subcode in Level 2 first.' }]);
  });

  it('gives a row a new parent of an existing name when asked for a new code', () => {
    const e = rowOf('Rules > Workarounds');
    e.choices = [{ new: true }];
    applyRowEdits([e]);
    expect(project.codes.filter((c) => c.name === 'Rules')).toHaveLength(2);
    expect(paths().filter((p) => p.startsWith('Rules >'))).toHaveLength(2);
  });

  it('uses the chosen code when several at that level have the name, and reports it otherwise', () => {
    applyRowEdits([{ ids: [], path: ['Rules'], choices: [{ new: true }], descriptions: [] }]); // a second "Rules"
    const second = project.codes.filter((c) => c.name === 'Rules').at(-1)!;
    const e = rowOf('Trust');
    e.path = ['Rules', 'X'];
    expect(applyRowEdits([{ ids: [], path: ['Rules', 'X'], descriptions: [] }]).problems[0].message).toContain('Several codes at this level are named “Rules”');
    expect(applyRowEdits([{ ids: [], path: ['Rules', 'X'], choices: [{ id: second.id }], descriptions: [] }]).problems).toEqual([]);
    expect(findCodeByPath(['Rules', 'X'])).toBeUndefined(); // the first "Rules" has no X …
    expect(project.codes.find((c) => c.name === 'X')?.parentId).toBe(second.id);
  });

  it('reports problems by the edit’s index and leaves the codebook as it was', () => {
    applyRowEdits([{ ids: [], path: ['Rules'], choices: [{ new: true }], descriptions: [] }]); // a second "Rules"
    const before = JSON.stringify(project.codes);
    const arrow = rowOf('Trust');
    arrow.path = ['Tr > ust'];
    const gap = rowOf('Trust');
    gap.path = ['Trust', '', 'Deep'];
    const unclear: RowEdit = { ids: [], path: ['Rules', 'New'], descriptions: [] };
    const { changed, problems } = applyRowEdits([arrow, gap, unclear]);
    expect(changed).toBe(0);
    expect(problems.map((p) => p.edit)).toEqual([0, 1, 2]);
    expect(problems[2].message).toContain('Several codes at this level are named “Rules”');
    expect(JSON.stringify(project.codes)).toBe(before);
  });
});

describe('reorderAsRows', () => {
  it('orders siblings like their (first) rows, keeps parents, and switches to the custom order', () => {
    // The codes of the rows after dragging Trust to the top and Complaints below Workarounds.
    reorderAsRows([id('Trust'), id('Rules'), id('Rules > Workarounds'), id('Rules > Complaints')]);
    expect(ui.codeSort).toBe('custom');
    expect(paths()).toEqual(['Trust', 'Rules > Workarounds', 'Rules > Complaints']);
    // Undo restores the codes' order (the sort setting stays custom).
    undo();
    expect(paths()).toEqual(['Rules > Workarounds', 'Rules > Complaints', 'Trust']);
  });
});

describe('pasting a copied code without subcodes', () => {
  it('names it "name (2)" (unique in its level), also under another parent', () => {
    applyRowEdits([{ ids: [], path: ['Feelings', 'Workarounds'], choices: [undefined, { copy: true, numbered: true }], descriptions: [] }]);
    expect(paths()).toContain('Feelings > Workarounds (2)');
    const e = rowOf('Rules > Complaints');
    e.path = ['Rules', 'Workarounds'];
    e.choices = [undefined, { copy: true, numbered: true }];
    applyRowEdits([e]);
    expect(paths()).toContain('Rules > Workarounds (3)');
  });
});

describe('pasting a copied code without subcodes as a new subcode', () => {
  it('names it "name (2)" too', () => {
    const e = rowOf('Trust');
    e.path = ['Trust', 'Complaints'];
    e.choices = [undefined, { copy: true, numbered: true }];
    applyRowEdits([e]);
    expect(paths()).toContain('Trust > Complaints (2)');
  });
});

describe('pasting a copied parent code into an empty row', () => {
  it('is the same code (same id), at any level; a code without subcodes only when picked or pasted', () => {
    expect(rowParentCode(['Rules', ''], [{ id: id('Rules') }])?.id).toBe(id('Rules'));
    expect(rowParentCode(['Rules', ''])?.id).toBe(id('Rules'));
    codeForPath('Rules > Workarounds > Shortcuts');
    expect(rowParentCode(['', 'Workarounds', ''], [undefined, { id: id('Rules > Workarounds') }])?.id).toBe(id('Rules > Workarounds'));
    expect(rowParentCode(['Trust', ''])).toBeUndefined();
    // Any code picked or pasted as that code is that code (the table decides when a paste is the same code).
    expect(rowParentCode(['Trust', ''], [{ id: id('Trust') }])?.id).toBe(id('Trust'));
    expect(rowParentCode(['', 'Complaints'], [undefined, { id: id('Rules > Complaints') }])?.id).toBe(id('Rules > Complaints'));
    expect(rowParentCode(['Rules', ''], [{ new: true }])).toBeUndefined();
  });

  it('puts a subcode typed next to it under that code', () => {
    const before = project.codes.length;
    applyRowEdits([{ ids: [], path: ['Rules', 'Exceptions'], choices: [{ id: id('Rules') }], descriptions: [] }]);
    expect(project.codes.length).toBe(before + 1);
    expect(findCodeByPath(['Rules', 'Exceptions'])?.parentId).toBe(id('Rules'));
  });

  it('is not made a subcode in a free level of another row', () => {
    const e = rowOf('Trust');
    e.path = ['Trust', 'Rules'];
    e.choices = [undefined, { id: id('Rules') }];
    expect(applyRowEdits([e]).problems).toHaveLength(1);
    expect(paths()).not.toContain('Trust > Rules');
  });
});

describe('pasting a code this project does not have', () => {
  it('makes a new code of that name and the copied color (subcodes keep their top code’s color)', () => {
    applyRowEdits([{ ids: [], path: ['Elsewhere'], choices: [{ new: true, color: '#22c55e' }], descriptions: [] }]);
    expect(findCodeByPath(['Elsewhere'])?.color).toBe('#22c55e');
    applyRowEdits([{ ids: [], path: ['Rules', 'Foreign'], choices: [undefined, { new: true, color: '#22c55e' }], descriptions: [] }]);
    expect(findCodeByPath(['Rules', 'Foreign'])?.color).toBe('#ef4444');
  });
});

describe('editing a parent cell', () => {
  it('renames the parent for all its rows when renaming is chosen, even to a name another code has', () => {
    codeForPath('Feelings > Fear');
    const e = rowOf('Rules > Workarounds');
    e.path = ['Feelings', 'Workarounds'];
    e.choices = [{ rename: true }];
    applyRowEdits([e]);
    expect(paths().filter((p) => p.startsWith('Feelings')).sort()).toEqual(['Feelings > Complaints', 'Feelings > Fear', 'Feelings > Workarounds']);
    expect(project.codes.filter((c) => c.name === 'Feelings')).toHaveLength(2);
  });

  it('moves only that row under a new parent code when that is chosen', () => {
    const e = rowOf('Rules > Workarounds');
    e.path = ['Vulnerable', 'Workarounds'];
    e.choices = [{ new: true }];
    applyRowEdits([e]);
    expect(paths()).toEqual(['Rules > Complaints', 'Trust', 'Vulnerable > Workarounds']);
  });
});

describe('inserting a level between a row’s codes', () => {
  it('puts a new code between the parent and the row’s code, or the existing one of that name', () => {
    const e = rowOf('Rules > Workarounds');
    e.inserts = [{ before: 1, name: 'Informal' }];
    applyRowEdits([e]);
    expect(paths()).toEqual(['Rules > Complaints', 'Rules > Informal > Workarounds', 'Trust']);
    expect(e.inserts[0].id).toBe(id('Rules > Informal'));
    const f = rowOf('Rules > Complaints');
    f.inserts = [{ before: 1, name: 'informal' }];
    applyRowEdits([f]);
    expect(paths()).toEqual(['Rules > Informal > Complaints', 'Rules > Informal > Workarounds', 'Trust']);
  });
});

describe('pasting a copy of a code in another level', () => {
  it('makes an identical copy with new ids: name, color, description, coded segments and subcodes', () => {
    const rules = findCodeByPath(['Rules'])!;
    rules.description = 'About rules';
    project.segments.push({ id: 's1', docId: 'd1', codeId: id('Rules > Workarounds'), start: 0, end: 4, text: 'test', createdAt: '' });
    project.consolidations.d1 = [{ id: 's2', docId: 'd1', codeId: id('Rules'), start: 0, end: 4, text: 'test', createdAt: '' }];
    const e = rowOf('Trust');
    e.path = ['Trust', 'Rules'];
    e.choices = [undefined, { copy: true, from: rules.id }];
    applyRowEdits([e]);
    expect(paths()).toContain('Trust > Rules > Workarounds');
    const copy = findCodeByPath(['Trust', 'Rules'])!;
    expect(copy.id).not.toBe(rules.id);
    expect(copy.description).toBe('About rules');
    expect(copy.color).toBe(rules.color);
    const copiedChild = findCodeByPath(['Trust', 'Rules', 'Workarounds'])!;
    expect(project.segments.filter((s) => s.codeId === copiedChild.id)).toHaveLength(1);
    expect(project.segments.find((s) => s.codeId === copiedChild.id)!.id).not.toBe('s1');
    expect(project.consolidations.d1.filter((s) => s.codeId === copy.id)).toHaveLength(1);
    // The original keeps its own.
    expect(project.segments.filter((s) => s.codeId === id('Rules > Workarounds'))).toHaveLength(1);
  });
});

describe('clearing a code’s cell', () => {
  it('deletes the code where the row is its last place, else takes the row out of the parent', () => {
    const own = rowOf('Rules > Complaints');
    own.path = ['Rules', ''];
    applyRowEdits([own]);
    expect(paths()).toEqual(['Rules > Workarounds', 'Trust']);
    // Rules has no other subcode now: clearing it deletes it, Workarounds moves up.
    const parent = rowOf('Rules > Workarounds');
    parent.path = ['', 'Workarounds'];
    applyRowEdits([parent]);
    expect(paths()).toEqual(['Trust', 'Workarounds']);
  });

  it('moves the row out of a parent that has other subcodes', () => {
    const e = rowOf('Rules > Complaints');
    e.path = ['', 'Complaints'];
    applyRowEdits([e]);
    expect(paths()).toEqual(['Complaints', 'Rules > Workarounds', 'Trust']);
  });
});

describe('pasting over a code’s own cell', () => {
  it('replaces it with the pasted code, its identical copy, or a new code of its name', () => {
    const same = rowOf('Rules > Complaints');
    same.path = ['Rules', 'Workarounds'];
    same.choices = [undefined, { id: id('Rules > Workarounds'), replace: true }];
    applyRowEdits([same]);
    expect(same.replacedBy).toBe(id('Rules > Workarounds'));
    expect(paths()).toEqual(['Rules > Workarounds', 'Trust']);
    const copy = rowOf('Trust');
    copy.path = ['Workarounds'];
    copy.choices = [{ copy: true, from: id('Rules > Workarounds'), replace: true }];
    applyRowEdits([copy]);
    expect(paths()).toEqual(['Rules > Workarounds', 'Workarounds']);
    expect(copy.created?.[0]).toBe(id('Workarounds'));
  });
});
