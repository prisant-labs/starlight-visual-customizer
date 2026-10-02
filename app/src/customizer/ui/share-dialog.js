/**
 * @file The share-link dialog, in two shapes. "Open the shared theme?" asks before a share link
 * replaces real work saved in this browser; "This share link is damaged" says why a link opened
 * nothing. `core/share-link.js` decides which one (if either) a visit needs; `panel.js` opens it.
 * Appended into panel.js's shadow root, like the export and contrast dialogs, so it reuses their
 * `.svc-dialog*` CSS and scales with "Studio sizing".
 *
 * Theme names come from the link itself, so every name goes in through `textContent`, never
 * `innerHTML`: a crafted link must not be able to inject markup.
 */
import { defaultState, getName } from '../core/state.js';

const DEFAULT_NAME = getName(defaultState());

/**
 * @param {{onOpenShared: (shared: import('../core/state.js').ThemeState) => void}} handlers
 *   `onOpenShared` runs when the visitor chooses the shared theme. Every other way out (the keep
 *   button, Escape, a backdrop click) keeps the saved theme.
 * @returns {{root: HTMLElement, openConflict: (shared: import('../core/state.js').ThemeState, saved: import('../core/state.js').ThemeState) => void, openDamaged: (keptWork: boolean) => void, close: () => void}}
 */
export function createShareLinkDialog(handlers) {
	const backdrop = document.createElement('div');
	backdrop.className = 'svc-dialog-backdrop';
	backdrop.hidden = true;
	backdrop.addEventListener('click', (event) => {
		if (event.target === backdrop) close();
	});
	backdrop.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') close();
	});

	const dialog = document.createElement('div');
	dialog.className = 'svc-dialog svc-share-dialog';
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	backdrop.appendChild(dialog);

	const header = document.createElement('div');
	header.className = 'svc-dialog-header';
	const title = document.createElement('h3');
	title.id = 'svc-share-title';
	header.appendChild(title);
	dialog.appendChild(header);
	dialog.setAttribute('aria-labelledby', title.id);

	const body = document.createElement('div');
	body.className = 'svc-share-body';
	dialog.appendChild(body);

	const footer = document.createElement('div');
	footer.className = 'svc-dialog-footer';
	dialog.appendChild(footer);

	function close() {
		backdrop.hidden = true;
	}

	/** @param {...(string | HTMLElement)} parts */
	function paragraph(...parts) {
		const p = document.createElement('p');
		for (const part of parts) p.append(part);
		return p;
	}

	/** @param {string} name */
	function quoted(name) {
		const b = document.createElement('b');
		b.textContent = `“${name}”`;
		return b;
	}

	/** @param {string} label @param {boolean} primary @param {() => void} onClick */
	function button(label, primary, onClick) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = primary ? 'svc-btn svc-btn-primary' : 'svc-btn';
		btn.textContent = label;
		btn.addEventListener('click', onClick);
		return btn;
	}

	/**
	 * @param {import('../core/state.js').ThemeState} shared
	 * @param {import('../core/state.js').ThemeState} saved
	 */
	function openConflict(shared, saved) {
		const sharedName = getName(shared);
		const savedName = getName(saved);
		title.textContent = 'Open the shared theme?';
		const intro = sharedName === DEFAULT_NAME ? paragraph('This link carries a theme.') : paragraph('This link carries a theme called ', quoted(sharedName), '.');
		let replaces;
		if (savedName === DEFAULT_NAME) replaces = paragraph('Opening it replaces your saved theme in this browser.');
		else if (savedName === sharedName) replaces = paragraph('Opening it replaces your saved theme, also called ', quoted(savedName), ', in this browser.');
		else replaces = paragraph('Opening it replaces your saved theme, ', quoted(savedName), ', in this browser.');
		const undo = paragraph('Undo switches back until you reload or leave the page.');
		body.replaceChildren(intro, replaces, undo);
		const keep = button('Keep my theme', false, close);
		const open = button('Open shared theme', true, () => {
			close();
			handlers.onOpenShared(shared);
		});
		footer.replaceChildren(keep, open);
		backdrop.hidden = false;
		// The safe choice takes focus, so Enter alone never replaces anyone's work.
		keep.focus();
	}

	/** @param {boolean} keptWork True when a saved theme (not just the defaults) was kept. */
	function openDamaged(keptWork) {
		title.textContent = 'This share link is damaged';
		body.replaceChildren(
			paragraph('The theme in this link could not be read. Links are often cut off when they are copied or sent in a message.'),
			paragraph(keptWork ? 'Your saved theme is unchanged.' : 'You are seeing the default theme.'),
			paragraph('Ask the sender for a fresh link.')
		);
		const ok = button('OK', true, close);
		footer.replaceChildren(ok);
		backdrop.hidden = false;
		ok.focus();
	}

	return { root: backdrop, openConflict, openDamaged, close };
}
