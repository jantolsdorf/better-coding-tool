import { commitUI, ui } from './store';

const MIN_PANEL = 70;

/**
 * Makes the sidebar panels resizable: dragging a .splitter moves height between the panels
 * above and below it. Heights are stored as flex-grow ratios so they survive window resizes.
 */
export function initSplitters(sidebar: HTMLElement) {
  const panels = () => [...sidebar.querySelectorAll<HTMLElement>(':scope > .panel')];
  for (const splitter of sidebar.querySelectorAll<HTMLElement>(':scope > .splitter')) {
    splitter.addEventListener('dblclick', () => {
      ui.panelFlex = null;
      commitUI();
    });
    splitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const all = panels();
      const above = splitter.previousElementSibling as HTMLElement;
      const below = splitter.nextElementSibling as HTMLElement;
      // Freeze every panel at its current height so only the two neighbours change.
      const heights = all.map((p) => p.offsetHeight);
      all.forEach((p, i) => setGrow(p, heights[i]));
      const startY = e.clientY;
      const a = above.offsetHeight;
      const b = below.offsetHeight;
      const move = (ev: MouseEvent) => {
        const dy = Math.max(MIN_PANEL - a, Math.min(b - MIN_PANEL, ev.clientY - startY));
        setGrow(above, a + dy);
        setGrow(below, b - dy);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing-rows');
        ui.panelFlex = panels().map((p) => p.offsetHeight);
        commitUI();
      };
      document.body.classList.add('resizing-rows');
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }
}

function setGrow(panel: HTMLElement, grow: number) {
  panel.style.flex = `${Math.max(1, Math.round(grow))} 1 0px`;
  panel.style.maxHeight = 'none';
}

/** Applies the saved panel heights (or the defaults from the stylesheet). */
export function applyPanelSizes(sidebar: HTMLElement) {
  const panels = [...sidebar.querySelectorAll<HTMLElement>(':scope > .panel')];
  panels.forEach((p, i) => {
    const grow = ui.panelFlex?.[i];
    if (grow) setGrow(p, grow);
    else {
      p.style.flex = '';
      p.style.maxHeight = '';
    }
  });
}
