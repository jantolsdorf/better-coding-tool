import { beforeEach, describe, expect, it } from 'vitest';
import { codeForPath, findCodeByPath } from '../src/model/codes';
import { commit } from '../src/model/state';
import type { Code } from '../src/model/types';
import { codeTreeRows } from '../src/view/codeTree';
import { freshProject } from './helpers';

const lines = (rows: ReturnType<typeof codeTreeRows>) => rows.map((r) => r.prefix + r.code.name);

beforeEach(() => {
  freshProject();
  codeForPath('AV infrastructure and implementation claims > Cryptography ensures age verification without identity storage or revelation');
  codeForPath('AV infrastructure and implementation claims > Costs');
  codeForPath('Trust');
  commit();
});

describe('codeTreeRows', () => {
  it('shows matches with their parents, as a tree', () => {
    expect(lines(codeTreeRows('cost'))).toEqual(['AV infrastructure and implementation claims', '└─ Costs']);
  });

  it('shows a new subcode under a code without subcodes, with all its parents (typed "… >")', () => {
    const parent = findCodeByPath(['AV infrastructure and implementation claims', 'Cryptography ensures age verification without identity storage or revelation'])!;
    const extra: Code = { id: '', name: 'new', color: '#000', parentId: parent.id };
    const q = 'AV infrastructure and implementation claims > Cryptography ensures age verification without identity storage or revelation >';
    expect(lines(codeTreeRows(q, { extra }))).toEqual([
      'AV infrastructure and implementation claims',
      '└─ Cryptography ensures age verification without identity storage or revelation',
      '   └─ new',
    ]);
  });
});

describe('a new subcode with a name', () => {
  it('is shown first among the subcodes it will join, under its parents', () => {
    const parent = findCodeByPath(['AV infrastructure and implementation claims'])!;
    const extra: Code = { id: '', name: 'Privacy', color: '#000', parentId: parent.id };
    expect(lines(codeTreeRows('AV infrastructure and implementation claims > Privacy', { extra }))).toEqual([
      'AV infrastructure and implementation claims',
      '├─ Privacy',
      '├─ Costs',
      '└─ Cryptography ensures age verification without identity storage or revelation',
    ]);
  });
});

describe('hidden subcodes', () => {
  it('lists only the top-level codes while nothing is searched, and the matches with their parents while searching', () => {
    expect(lines(codeTreeRows('', { collapsed: true }))).toEqual(['AV infrastructure and implementation claims', 'Trust']);
    expect(lines(codeTreeRows('cost', { collapsed: true }))).toEqual(['AV infrastructure and implementation claims', '└─ Costs']);
  });
});
