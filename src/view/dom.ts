// Small DOM helpers for the views.

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
