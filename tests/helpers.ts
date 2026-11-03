// A fresh, empty project for each test, with documents added from plain text.

import { addDocs } from '../src/model/documents';
import { emptyProject } from '../src/model/parse';
import { replaceProject } from '../src/model/state';
import type { Doc } from '../src/model/types';

export function freshProject(...texts: string[]): Doc[] {
  localStorage.clear();
  replaceProject(emptyProject('Tester'));
  return texts.length ? addDocs(texts.map((content, i) => ({ name: `doc${i + 1}.txt`, content })), null) : [];
}
