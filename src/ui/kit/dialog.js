/**
 * dialog.js -- confirm(): ask a yes/no question in a small modal Dialog, mounted into document.body for the
 * length of the question.
 *
 *   if (await confirm({ title: 'Discard unsaved changes?', confirmLabel: 'Discard', danger: true })) …
 *
 * Resolves true only on the confirm button; Cancel, Escape, the × and the backdrop resolve false. Focus starts
 * on the confirm button (Enter confirms), or on Cancel when `danger` (WAI-ARIA APG: the least destructive
 * action first; Tab, Enter to destroy). The dialog takes the theme of the element that had focus (falling
 * back to the document's), and focus returns there afterwards.
 */
import { mount, unmount } from 'svelte';
import Dialog from './Dialog.svelte';

/**
 * @param {{ title?: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} o
 * @returns {Promise<boolean>}
 */
export function confirm({ title = 'Are you sure?', message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.style.display = 'contents';
    const theme = document.activeElement?.closest?.('[data-theme]')?.getAttribute('data-theme');
    if (theme) host.setAttribute('data-theme', theme);
    document.body.append(host);
    const app = mount(Dialog, {
      target: host,
      props: {
        open: true, title, message, size: 'sm', role: 'alertdialog',
        actions: [
          { label: cancelLabel, value: 'cancel', autofocus: danger },
          { label: confirmLabel, value: 'confirm', variant: danger ? 'danger' : 'primary', autofocus: !danger },
        ],
        onclose(reason) {
          resolve(reason === 'confirm');
          // ponytail: a fixed wait that outlasts the --t-move (200ms) exit transition; read the token if it grows.
          setTimeout(() => { unmount(app); host.remove(); }, 300);
        },
      },
    });
  });
}
