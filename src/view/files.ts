// Choosing files to import and saving exported files.

import { h } from './dom';
import { currentDocument, currentWindow } from './windows';

export function downloadFile(name: string, content: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = h('a', { href: url, download: name });
  // In the window used last: browsers only allow this in the window that was clicked.
  currentDocument().body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    // Adopted by the window used last, since only the clicked window may open a file picker.
    const input = currentDocument().adoptNode(h('input', { type: 'file', accept, multiple }));
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/** Copies text to the clipboard; resolves false if the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await currentWindow().navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers or insecure contexts: copy through a temporary text field.
    const doc = currentDocument();
    const area = doc.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    doc.body.append(area);
    area.select();
    const ok = doc.execCommand('copy');
    area.remove();
    return ok;
  }
}
