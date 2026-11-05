import { beforeEach, describe, expect, it } from 'vitest';
import { codeForPath, codePath, findCodeByPath, matchesCodeQuery, splitCodePath } from '../src/model/codes';
import { project } from '../src/model/state';
import { freshProject } from './helpers';

beforeEach(() => {
  freshProject();
});

describe('code paths', () => {
  it('splits "Parent > Child" (also with ›) and drops empty parts', () => {
    expect(splitCodePath(' Parent >  Child › Sub ')).toEqual(['Parent', 'Child', 'Sub']);
    expect(splitCodePath('Parent >')).toEqual(['Parent']);
    expect(splitCodePath('  ')).toEqual([]);
  });

  it('creates missing parents once and finds codes case-insensitively', () => {
    const child = codeForPath('Parent > Child', '#ff0000');
    const sibling = codeForPath(['parent', 'Sibling']);
    expect(project.codes).toHaveLength(3);
    expect(sibling.parentId).toBe(child.parentId);
    expect(codePath(child)).toBe('Parent > Child');
    expect(findCodeByPath(['PARENT', 'child'])).toBe(child);
    expect(findCodeByPath(['Child'])).toBeUndefined();
  });

  it('matches searches by name and by path', () => {
    const c = codeForPath('Trust > Distrust');
    expect(matchesCodeQuery(c, 'dist')).toBe(true);
    expect(matchesCodeQuery(c, 'trust > dist')).toBe(true);
    expect(matchesCodeQuery(c, 'other > dist')).toBe(false);
  });
});

describe('applying a code as another code of the same name', () => {
  it('creates a new code at the path, beside the existing one, and codes the passage with it', async () => {
    const { applyCode } = await import('../src/model/coding');
    const [doc] = freshProject('Some text to code here.');
    const first = applyCode(doc.id, 0, 4, 'Trust > Institutions')!.code;
    const again = applyCode(doc.id, 5, 9, 'Trust > Institutions')!.code;
    expect(again.id).toBe(first.id);
    const another = applyCode(doc.id, 10, 14, 'Trust > Institutions', undefined, { another: true })!.code;
    expect(another.id).not.toBe(first.id);
    expect(another.parentId).toBe(first.parentId);
    expect(project.codes.filter((c) => c.name === 'Institutions')).toHaveLength(2);
    expect(project.segments.filter((s) => s.codeId === another.id)).toHaveLength(1);
  });
});
