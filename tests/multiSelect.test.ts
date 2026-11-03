import { describe, expect, it } from 'vitest';
import { cycleWithChildren } from '../src/view/multiSelect';

describe('cycleWithChildren', () => {
  it('selects the parent, then with its subcodes, then nothing', () => {
    const keys = new Set<string>(['other']);
    cycleWithChildren(keys, 'p', ['a', 'b']);
    expect([...keys].sort()).toEqual(['other', 'p']);
    cycleWithChildren(keys, 'p', ['a', 'b']);
    expect([...keys].sort()).toEqual(['a', 'b', 'other', 'p']);
    cycleWithChildren(keys, 'p', ['a', 'b']);
    expect([...keys]).toEqual(['other']);
  });

  it('selects the rest of the subcodes if only some are selected, and toggles codes without subcodes', () => {
    const keys = new Set(['p', 'a']);
    cycleWithChildren(keys, 'p', ['a', 'b']);
    expect([...keys].sort()).toEqual(['a', 'b', 'p']);
    cycleWithChildren(keys, 'leaf', []);
    expect(keys.has('leaf')).toBe(true);
    cycleWithChildren(keys, 'leaf', []);
    expect(keys.has('leaf')).toBe(false);
  });
});
