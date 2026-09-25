// Warns before the tab is closed or reloaded while the project has changes that were not
// downloaded, and offers to download a copy.
//
// Browsers only allow their own generic "Leave site?" confirmation when a tab closes; its text
// and buttons cannot be changed. So when the user chooses to stay, this page then shows its own
// dialog with a download button.

import { exportProject, hasChangesNotDownloaded } from '../controller/transfer';
import { h } from './dom';

export function initLeaveGuard() {
  window.addEventListener('beforeunload', (e) => {
    if (!hasChangesNotDownloaded()) return;
    e.preventDefault();
    e.returnValue = ''; // Needed by some browsers to show the confirmation.
    // Timers only run again once the user has chosen to stay on the page.
    setTimeout(offerDownload, 50);
  });
}

/** Offers to download a copy of the project; also usable without trying to leave. */
export function offerDownload() {
  if (document.querySelector('dialog.backup[open]') || !hasChangesNotDownloaded()) return;
  const text = h(
    'p',
    { class: 'muted' },
    'Your project is saved in this browser, but your latest changes are not in a downloaded copy yet. ' +
      'A copy keeps your work safe if the browser data is cleared, and lets you move it to another computer.',
  );
  const download = h('button', { class: 'btn primary' }, 'Download copy (.zip)');
  const keep = h('button', { class: 'btn' }, 'Keep working');
  const foot = h('div', { class: 'modal-foot' }, h('span', { class: 'grow' }), keep, download);
  const dlg = h(
    'dialog',
    { class: 'modal backup' },
    h('div', { class: 'modal-inner' }, h('div', { class: 'modal-head' }, h('strong', {}, 'Download a copy before you leave?')), h('div', { class: 'modal-body' }, text), foot),
  );
  keep.addEventListener('click', () => dlg.close());
  download.addEventListener('click', () => {
    exportProject();
    text.textContent = 'Downloaded. You can close the tab now — your project also stays saved in this browser.';
    download.remove();
    keep.textContent = 'OK';
    keep.focus();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  download.focus();
}
