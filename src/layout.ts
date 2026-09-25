import { commitUI, ui } from './store';
import type { MainArea } from './types';

const AREA_DND_TYPE = 'application/x-bct-area';
const AREAS: MainArea[] = ['sidebar', 'viewer', 'segments'];
const MIN_WIDTH = 180;
const MAX_WIDTH = 700;

let layoutEl: HTMLElement;
const areaEl = (a: MainArea) => layoutEl.querySelector<HTMLElement>(`[data-area="${a}"]`)!;

/** The saved order, repaired if it is missing an area (e.g. from an older version). */
function order(): MainArea[] {
  const saved = (ui.mainOrder ?? []).filter((a) => AREAS.includes(a));
  return [...new Set([...saved, ...AREAS])];
}

/**
 * The three main areas (documents & codebook, text, coded segments) can be put in any order by
 * dragging their ⋮⋮ grip, and the two side areas resized by dragging their inner edge.
 */
export function initMainLayout(layout: HTMLElement) {
  layoutEl = layout;
  for (const area of AREAS) {
    const el = areaEl(area);
    const grip = el.querySelector<HTMLElement>('.area-grip');
    grip?.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer?.setData(AREA_DND_TYPE, area);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setDragImage(el, 20, 20);
      }
      requestAnimationFrame(() => el.classList.add('area-dragging'));
    });
    grip?.addEventListener('dragend', () => el.classList.remove('area-dragging'));

    const clear = () => el.classList.remove('area-drop-before', 'area-drop-after');
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(AREA_DND_TYPE)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      el.classList.toggle('area-drop-after', after);
      el.classList.toggle('area-drop-before', !after);
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget as Node)) clear();
    });
    el.addEventListener('drop', (e) => {
      const dragged = e.dataTransfer?.getData(AREA_DND_TYPE) as MainArea | undefined;
      if (!dragged) return;
      e.preventDefault();
      e.stopPropagation();
      const after = el.classList.contains('area-drop-after');
      clear();
      if (dragged === area) return;
      const next = order().filter((a) => a !== dragged);
      next.splice(next.indexOf(area) + (after ? 1 : 0), 0, dragged);
      ui.mainOrder = next;
      commitUI();
    });

    const handle = el.querySelector<HTMLElement>('.area-resizer');
    if (handle && area !== 'viewer') makeAreaResizable(el, handle, area);
  }
}

function makeAreaResizable(el: HTMLElement, handle: HTMLElement, area: 'sidebar' | 'segments') {
  const save = (w: number | null) => {
    if (area === 'sidebar') ui.sidebarWidth = w;
    else ui.segmentsWidth = w;
    commitUI();
  };
  handle.addEventListener('dblclick', () => save(null));
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = el.offsetWidth;
    // The handle sits on the edge facing the text, so dragging towards the text widens the area.
    const sign = handle.classList.contains('left') ? -1 : 1;
    let width = startW;
    const move = (ev: MouseEvent) => {
      width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + sign * (ev.clientX - startX)));
      el.style.flexBasis = `${width}px`;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
      if (width !== startW) save(Math.round(width));
    };
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

export function applyMainLayout() {
  const areas = order();
  const viewerAt = areas.indexOf('viewer');
  areas.forEach((area, i) => {
    const el = areaEl(area);
    el.style.order = String(i);
    // Borders and the resize handle go on the side facing the text.
    el.classList.toggle('left-of-viewer', i < viewerAt);
    el.classList.toggle('right-of-viewer', i > viewerAt);
    el.querySelector('.area-resizer')?.classList.toggle('left', i > viewerAt);
  });
  const width = (w: number | null) => (w ? `${w}px` : '');
  areaEl('sidebar').style.flexBasis = width(ui.sidebarWidth);
  areaEl('segments').style.flexBasis = width(ui.segmentsWidth);
}
