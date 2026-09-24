import type { Doc } from './types';

export const PALETTE = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#ec4899', '#84cc16',
  '#6366f1', '#f97316', '#06b6d4', '#e11d48', '#10b981', '#8b5cf6', '#ca8a04', '#0ea5e9',
];

type Child = Node | string | null | undefined | false;

/** Tiny DOM builder: h('div', { class: 'x', onClick: fn }, 'text', otherNode) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(el.style, v);
    } else if (k in el && typeof v !== 'string') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  el.append(...(children.filter((c) => c != null && c !== false) as (Node | string)[]));
  return el;
}

export function hexToRgba(hex: string, alpha: number): string {
  let m = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1];
  const short = /^#?([0-9a-f]{3})$/i.exec(hex)?.[1];
  if (!m && short) m = short.split('').map((c) => c + c).join('');
  if (!m) return `rgba(150,150,150,${alpha})`;
  const n = parseInt(m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const lineCache = new Map<string, { content: string; starts: number[] }>();

/** Offsets at which each line of the document starts. */
export function lineStartsOf(doc: Doc): number[] {
  const cached = lineCache.get(doc.id);
  if (cached && cached.content === doc.content) return cached.starts;
  const starts = [0];
  for (let i = 0; i < doc.content.length; i++) if (doc.content[i] === '\n') starts.push(i + 1);
  lineCache.set(doc.id, { content: doc.content, starts });
  return starts;
}

/** 0-based index of the line containing offset. */
export function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function lineSpan(doc: Doc, start: number, end: number): [number, number] {
  const starts = lineStartsOf(doc);
  return [lineOf(starts, start) + 1, lineOf(starts, Math.max(start, end - 1)) + 1];
}

export function lineLabel(doc: Doc, start: number, end: number): string {
  const [a, b] = lineSpan(doc, start, end);
  return a === b ? `L${a}` : `L${a}–L${b}`;
}

export function downloadFile(name: string, content: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple });
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

export function safeFileName(s: string): string {
  return s.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'project';
}

export function toast(message: string, ms = 3500) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts' });
    document.body.append(host);
  }
  const t = h('div', { class: 'toast' }, message);
  host.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
