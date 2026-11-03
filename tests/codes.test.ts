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
