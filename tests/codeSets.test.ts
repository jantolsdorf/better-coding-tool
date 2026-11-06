import { beforeEach, describe, expect, it } from 'vitest';
import { addCodesToSet, codeSets, createCodeSet, deleteCodeSet, freeSetName, removeCodeFromSet, renameCodeSet, setsOfCode } from '../src/model/codeSets';
import { codeForPath, deleteCodes, mergeCode } from '../src/model/codes';
import { parseProject } from '../src/model/parse';
import { commit, project, undo } from '../src/model/state';
import { freshProject } from './helpers';

const names = (ids: string[]) => ids.map((id) => project.codes.find((c) => c.id === id)?.name);

beforeEach(() => {
  freshProject();
  codeForPath('Rules > Workarounds');
  codeForPath('Rules > Complaints');
  codeForPath('Trust');
  commit();
});

const id = (path: string) => codeForPath(path).id;

describe('code sets', () => {
  it('groups codes from anywhere in the hierarchy, each code once, in the order added', () => {
    const set = createCodeSet('RQ1', [id('Trust'), id('Rules > Workarounds'), id('Trust')]);
    expect(names(set.codeIds)).toEqual(['Trust', 'Workarounds']);
    expect(addCodesToSet(set.id, [id('Trust'), id('Rules > Complaints')])).toBe(1);
    expect(names(set.codeIds)).toEqual(['Trust', 'Workarounds', 'Complaints']);
    // A code can be in several sets.
    createCodeSet('RQ2', [id('Trust')]);
    expect(setsOfCode(id('Trust')).map((s) => s.name)).toEqual(['RQ1', 'RQ2']);
  });

  it('renames, removes codes and deletes sets, each as one undo step, without touching the codebook', () => {
    const set = createCodeSet('RQ1', [id('Trust'), id('Rules')]);
    renameCodeSet(set.id, 'Round 1');
    removeCodeFromSet(set.id, id('Rules'));
    expect(codeSets()[0]).toMatchObject({ name: 'Round 1' });
    expect(names(codeSets()[0].codeIds)).toEqual(['Trust']);
    deleteCodeSet(set.id);
    expect(codeSets()).toEqual([]);
    expect(project.codes).toHaveLength(4);
    undo();
    expect(codeSets()[0].name).toBe('Round 1');
  });

  it('drops deleted codes from sets, and puts a merged code’s target in its place', () => {
    const set = createCodeSet('RQ1', [id('Rules > Workarounds'), id('Trust')]);
    mergeCode(id('Rules > Workarounds'), id('Rules > Complaints'));
    expect(names(codeSets()[0].codeIds)).toEqual(['Complaints', 'Trust']);
    deleteCodes([id('Trust')]);
    expect(names(codeSets().find((s) => s.id === set.id)!.codeIds)).toEqual(['Complaints']);
  });

  it('names new sets uniquely', () => {
    createCodeSet(freeSetName());
    expect(freeSetName()).toBe('New set 2');
  });

  it('is kept in project files, with only codes the project has', () => {
    const trust = id('Trust');
    const p = parseProject({ ...JSON.parse(JSON.stringify(project)), codeSets: [{ id: 's1', name: 'RQ1', codeIds: [trust, 'gone', trust] }, { name: 'broken' }] });
    expect(p.codeSets).toEqual([{ id: 's1', name: 'RQ1', codeIds: [trust] }]);
  });
});
