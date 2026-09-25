// Small pure helpers shared by the model (and usable by the other layers).

export const PALETTE = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#ec4899', '#84cc16',
  '#6366f1', '#f97316', '#06b6d4', '#e11d48', '#10b981', '#8b5cf6', '#ca8a04', '#0ea5e9',
];

export function uid(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const now = () => new Date().toISOString();

export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

export function safeFileName(s: string): string {
  return s.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'project';
}
