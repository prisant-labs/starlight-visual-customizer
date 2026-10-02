/**
 * @file A hex-first color popover, replacing the native
 * `<input type=color>` swatch button - Chrome's own picker dialog cannot be told to
 * open in hex mode, and hex is the primary way colors are entered here. Wraps vanilla-colorful's
 * framework-free `<hex-color-picker>` custom element (a
 * saturation/brightness area plus a hue bar, MIT, npm `vanilla-colorful` 0.7.2 - see the package's
 * README/Context7 docs read before this file was written) with our OWN hex text field as the
 * popover's default entry (same validation contract as the row's primary hex field - the caller
 * supplies `normalizeHex`), plus an eyedropper button gated on `'EyeDropper' in window`.
 * A HEX | RGB | HSL switch above the fields brings back the format choice Chrome's dialog had;
 * hex is the default, and RGB/HSL fields convert to hex before anything is committed.
 *
 * `position: fixed` and appended as an ordinary descendant of whatever row calls
 * `createColorPopover` (NOT hoisted to the shadow root's top level): no ancestor in this shadow
 * root's stylesheet (`styles.js`) sets `transform`/`filter`/`perspective`/`will-change: transform`,
 * so no ancestor becomes a containing block for a fixed-position descendant - the popover positions
 * and clips against the real VIEWPORT exactly like `target-highlight.js`'s overlay does (that one
 * happens to be appended at the shadow root's top level for its own unrelated reasons; a fixed-
 * position element does not need to be top-level to escape a scrolling/`overflow:hidden` ancestor's
 * clipping, only to avoid a transformed one - see `positionPopover` below for the viewport-relative
 * math this relies on).
 *
 * Deliberately imported ONLY from `controls.js`: `import 'vanilla-colorful/hex-color-picker.js'`
 * calls `customElements.define('hex-color-picker', ...)` at module-evaluation time, which throws
 * outside a browser (Node unit tests, the e2e scripts' own Node-side code) - keeping that import
 * confined to this one browser-only module, itself imported only from the browser-only
 * `controls.js`, means the Node-run test suites (which import `controls.js`'s pure helpers like
 * `normalizeHexInput` are never exercised that way today, but the constraint is the same one
 * `tile-grid.js`'s nested shadow roots already rely on) never load a custom-element definition.
 */
import 'vanilla-colorful/hex-color-picker.js';
import { hexToRgbChannels, rgbChannelsToHex, hexToHslChannels, hslChannelsToHex } from '../core/color.js';
import { getChromeZoom } from './studio-sizing.js';

let uidCounter = 0;

/** The popover's color formats. Each channel is [key, caption, spoken name, max]. */
const FORMATS = [
	{ id: 'hex', label: 'HEX' },
	{
		id: 'rgb',
		label: 'RGB',
		channels: [['r', 'R', 'Red', 255], ['g', 'G', 'Green', 255], ['b', 'B', 'Blue', 255]],
		toChannels: hexToRgbChannels,
		toHex: rgbChannelsToHex,
	},
	{
		id: 'hsl',
		label: 'HSL',
		channels: [['h', 'H', 'Hue', 359], ['s', 'S', 'Saturation', 100], ['l', 'L', 'Lightness', 100]],
		toChannels: hexToHslChannels,
		toHex: hslChannelsToHex,
	},
];
const FORMAT_STORAGE_KEY = 'svc-color-format';
/** The last format picked, shared by every popover on the page and remembered per browser.
 * `localStorage` can be missing or throw (a private window, blocked site data), so the page-level
 * copy keeps the choice for this visit and everything falls back to hex. */
let pageFormat = null;
function readFormat() {
	if (pageFormat) return pageFormat;
	try {
		const stored = localStorage.getItem(FORMAT_STORAGE_KEY);
		if (FORMATS.some((f) => f.id === stored)) return stored;
	} catch {
		/* storage blocked - hex */
	}
	return 'hex';
}
function rememberFormat(id) {
	pageFormat = id;
	try {
		localStorage.setItem(FORMAT_STORAGE_KEY, id);
	} catch {
		/* storage blocked - the choice lasts this page view only */
	}
}
/** Only one popover open at a time, across every control's own instance - opening a second one
 * closes whichever was already open, same as a native `<select>`/menu would. */
let currentlyOpen = null;

const EYEDROPPER_ICON_SVG =
	'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 7l6 6M4 20l3.3-1 7.7-7.7-2.3-2.3L5 16.7 4 20z"/><path d="M14.5 4.5a2.1 2.1 0 013 3L16 9l-3-3z"/></svg>';

/**
 * @param {{
 *   label: string,
 *   normalizeHex: (raw: string) => string | null,
 *   onChange: (hex: string, opts: {settled: boolean}) => void,
 * }} options `onChange` fires with `settled:false` on every live drag tick/keystroke-commit (the
 *   caller coalesces these into one undo step the same way a slider drag already does) and once
 *   more with `settled:true` when the interaction ends (drag release, Enter/blur on the popover's
 *   own hex field, or an eyedropper pick) - the caller uses `settled:true` to re-sync the row's
 *   OWN hex field/note to the just-produced color without fighting an in-progress drag.
 * @returns {{
 *   button: HTMLButtonElement, popover: HTMLElement,
 *   open: (seedHex: string) => void, close: () => void, toggle: (seedHex: string) => void,
 *   isOpen: () => boolean, setSwatch: (hex: string) => void,
 * }}
 */
export function createColorPopover({ label, normalizeHex, onChange }) {
	const uid = uidCounter++;

	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'svc-color-picker';
	button.title = 'Pick a color';
	button.setAttribute('aria-label', `Pick a color for ${label}`);
	button.setAttribute('aria-haspopup', 'dialog');
	button.setAttribute('aria-expanded', 'false');

	const popover = document.createElement('div');
	popover.className = 'svc-color-popover';
	popover.id = `svc-color-popover-${uid}`;
	popover.hidden = true;
	popover.setAttribute('role', 'dialog');
	popover.setAttribute('aria-label', `${label} color picker`);
	button.setAttribute('aria-controls', popover.id);

	const picker = document.createElement('hex-color-picker');
	popover.appendChild(picker);

	const formatBar = document.createElement('div');
	formatBar.className = 'svc-color-format';
	formatBar.setAttribute('role', 'group');
	formatBar.setAttribute('aria-label', 'Color format');
	const formatButtons = new Map();
	for (const f of FORMATS) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'svc-color-format-btn';
		btn.dataset.format = f.id;
		btn.textContent = f.label;
		btn.setAttribute('aria-pressed', 'false');
		btn.addEventListener('click', () => {
			rememberFormat(f.id);
			setFormat(f.id);
			firstField().focus();
		});
		formatButtons.set(f.id, btn);
		formatBar.appendChild(btn);
	}
	popover.appendChild(formatBar);

	const hexRow = document.createElement('div');
	hexRow.className = 'svc-color-popover-hexrow';
	const hexField = document.createElement('input');
	hexField.type = 'text';
	hexField.className = 'svc-color-hex svc-color-popover-hex';
	hexField.spellcheck = false;
	hexField.autocomplete = 'off';
	hexField.placeholder = '#rrggbb';
	hexField.setAttribute('aria-label', `Hex color for ${label}`);
	hexRow.appendChild(hexField);

	/** RGB and HSL fields: three small whole-number boxes each, captioned like Chrome's own. */
	const channelGroups = new Map();
	for (const f of FORMATS) {
		if (!f.channels) continue;
		const group = document.createElement('div');
		group.className = 'svc-color-channels';
		group.dataset.format = f.id;
		group.hidden = true;
		const inputs = f.channels.map(([key, caption, spoken, max]) => {
			const cell = document.createElement('label');
			cell.className = 'svc-color-channel';
			const input = document.createElement('input');
			input.type = 'text';
			input.inputMode = 'numeric';
			input.autocomplete = 'off';
			input.spellcheck = false;
			input.maxLength = 3;
			input.dataset.channel = key;
			input.setAttribute('aria-label', `${spoken}, 0 to ${max}, for ${label}`);
			const text = document.createElement('span');
			text.textContent = caption;
			text.setAttribute('aria-hidden', 'true');
			cell.append(input, text);
			group.appendChild(cell);
			input.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				commitChannels(f.id);
			});
			input.addEventListener('change', () => commitChannels(f.id));
			return input;
		});
		channelGroups.set(f.id, { format: f, group, inputs, lastSet: '' });
		hexRow.appendChild(group);
	}

	let eyedropperBtn = null;
	if (typeof window !== 'undefined' && 'EyeDropper' in window) {
		eyedropperBtn = document.createElement('button');
		eyedropperBtn.type = 'button';
		eyedropperBtn.className = 'svc-eyedropper-btn';
		eyedropperBtn.title = 'Pick a color from the screen';
		eyedropperBtn.setAttribute('aria-label', 'Pick a color from the screen with the eyedropper');
		eyedropperBtn.innerHTML = EYEDROPPER_ICON_SVG;
		eyedropperBtn.addEventListener('click', async () => {
			try {
				// `EyeDropper` requires a user gesture and must be opened directly inside one - no
				// `await` or other async work happens before this call.
				const ed = new window.EyeDropper();
				const result = await ed.open();
				if (result?.sRGBHex) {
					const normalized = normalizeHex(result.sRGBHex) ?? result.sRGBHex;
					picker.color = normalized;
					syncHexField(normalized);
					lastHex = normalized;
					onChange(normalized, { settled: true });
				}
			} catch {
				/* the person cancelled the eyedropper (Escape/right-click) - not an error */
			}
		});
		hexRow.appendChild(eyedropperBtn);
	}
	popover.appendChild(hexRow);

	let isOpen = false;
	let lastHex = null;
	let settleTimer = null;
	/** The button alone doesn't know "the current resolved color" (that's the caller's state) - its
	 * click handler re-reads this, kept fresh by `setSwatch` (every caller sets the swatch to the
	 * current resolved color right after building/refreshing the row, so the two never drift). */
	let currentSeed = '#000000';
	/** Same bug fix as the row's own primary hex field (see controls.js's `buildColorAssistRow`):
	 * `hexFieldLastSet` is whatever the field currently shows because WE put it there (open, a live
	 * drag mirroring `hexField.value`, or the eyedropper) - never because the person's own edit is
	 * still pending. `blur` (fired e.g. when Escape or an outside click hides the popover while the
	 * field still has focus) is a no-op unless the field's text actually differs from this, so closing
	 * the popover without ever touching its hex field can never silently re-commit the seed color
	 * through a lossy hex round-trip. `syncHexField` is the only way `.value` should be set from
	 * outside a genuine keystroke. */
	let hexFieldLastSet = null;
	function syncHexField(value) {
		hexField.value = value;
		hexFieldLastSet = value;
		for (const entry of channelGroups.values()) {
			const channels = entry.format.toChannels(value);
			if (!channels) continue;
			entry.format.channels.forEach(([key], i) => {
				entry.inputs[i].value = String(channels[key]);
			});
			entry.lastSet = entry.inputs.map((input) => input.value).join(',');
		}
	}

	let format = 'hex';
	function setFormat(id) {
		format = id;
		for (const [fid, btn] of formatButtons) btn.setAttribute('aria-pressed', String(fid === id));
		hexField.hidden = id !== 'hex';
		for (const [fid, entry] of channelGroups) entry.group.hidden = fid !== id;
	}
	function firstField() {
		return format === 'hex' ? hexField : channelGroups.get(format).inputs[0];
	}

	function scheduleSettle() {
		clearTimeout(settleTimer);
		settleTimer = setTimeout(() => {
			if (lastHex) onChange(lastHex, { settled: true });
		}, 200);
	}

	picker.addEventListener('color-changed', (event) => {
		const hex = event.detail.value;
		lastHex = hex;
		syncHexField(hex);
		onChange(hex, { settled: false });
		scheduleSettle();
	});
	// A mouse/pointer drag on the saturation area or hue bar ends with pointerup - settle
	// immediately rather than waiting out `scheduleSettle`'s trailing timer.
	picker.addEventListener('pointerup', () => {
		clearTimeout(settleTimer);
		if (lastHex) onChange(lastHex, { settled: true });
	});

	function commitHexField() {
		if (hexField.value === hexFieldLastSet) return false; // nothing the person actually changed
		const normalized = normalizeHex(hexField.value);
		if (!normalized) return false;
		picker.color = normalized;
		lastHex = normalized;
		syncHexField(normalized);
		onChange(normalized, { settled: true });
		return true;
	}
	hexField.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		commitHexField();
	});
	hexField.addEventListener('blur', () => commitHexField());

	/** The RGB/HSL counterpart of `commitHexField`, with the same no-op rule: nothing happens unless
	 * the person changed a box. A box that is empty or not a whole number puts all three back to
	 * the current color instead of committing a guess. */
	function commitChannels(formatId) {
		const entry = channelGroups.get(formatId);
		const typed = entry.inputs.map((input) => input.value.trim());
		if (typed.join(',') === entry.lastSet) return false;
		const values = Object.fromEntries(
			entry.format.channels.map(([key], i) => [key, /^\d{1,3}$/.test(typed[i]) ? Number(typed[i]) : NaN])
		);
		const hex = entry.format.toHex(values);
		if (!hex) {
			syncHexField(lastHex ?? currentSeed);
			return false;
		}
		picker.color = hex;
		lastHex = hex;
		syncHexField(hex);
		onChange(hex, { settled: true });
		return true;
	}

	function onOutsidePointerDown(event) {
		const path = event.composedPath();
		if (path.includes(popover) || path.includes(button)) return;
		api.close();
	}
	function onDocumentKeydown(event) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		api.close();
		button.focus();
	}

	/** Viewport-relative placement (see the file header): measured from the button's own
	 * `getBoundingClientRect()`, then flipped/clamped once the popover's real size is known. Every
	 * comparison happens in on-screen pixels; only the assigned values are divided by the studio's
	 * chrome zoom ("Studio sizing"), because the zoomed panel multiplies them back when drawing. */
	function positionPopover() {
		const zoom = getChromeZoom();
		const rect = button.getBoundingClientRect();
		const margin = 6;
		popover.style.top = `${(rect.bottom + margin) / zoom}px`;
		popover.style.left = `${rect.left / zoom}px`;
		requestAnimationFrame(() => {
			if (!isOpen) return;
			const popRect = popover.getBoundingClientRect();
			if (popRect.bottom > window.innerHeight) {
				popover.style.top = `${Math.max(margin, rect.top - popRect.height - margin) / zoom}px`;
			}
			if (popRect.right > window.innerWidth) {
				popover.style.left = `${Math.max(margin, window.innerWidth - popRect.width - margin) / zoom}px`;
			}
		});
	}

	const api = {
		button,
		popover,
		open(seedHex) {
			if (isOpen) return;
			if (currentlyOpen && currentlyOpen !== api) currentlyOpen.close();
			currentlyOpen = api;
			isOpen = true;
			lastHex = seedHex;
			picker.color = seedHex;
			syncHexField(seedHex);
			setFormat(readFormat());
			popover.hidden = false;
			button.setAttribute('aria-expanded', 'true');
			positionPopover();
			document.addEventListener('pointerdown', onOutsidePointerDown, true);
			document.addEventListener('keydown', onDocumentKeydown, true);
			// A real click already focuses the button; move focus into the popover's first field for
			// the current format (the hex field by default), same as any other opened popover/menu.
			requestAnimationFrame(() => firstField().focus());
		},
		close() {
			if (!isOpen) return;
			isOpen = false;
			clearTimeout(settleTimer);
			popover.hidden = true;
			button.setAttribute('aria-expanded', 'false');
			document.removeEventListener('pointerdown', onOutsidePointerDown, true);
			document.removeEventListener('keydown', onDocumentKeydown, true);
			if (currentlyOpen === api) currentlyOpen = null;
		},
		toggle(seedHex) {
			if (isOpen) api.close();
			else api.open(seedHex);
		},
		isOpen: () => isOpen,
		setSwatch(hex) {
			currentSeed = hex;
			button.style.background = hex;
		},
	};
	button.addEventListener('click', () => api.toggle(currentSeed));

	return api;
}
