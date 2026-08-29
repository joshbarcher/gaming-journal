/**
 * stickywall.js — StickyWall DOM component
 * @version 1.4.5
 *
 * Renders a corkboard-style wall of sticky notes. No dependencies — drop in
 * the JS and CSS, mount on any element, and wire up events.
 *
 * ── REQUIRED FILES ────────────────────────────────────────────────────────────
 *
 *   stickywall.js       — this file (ESM class export)
 *   stickywall.css      — base structural styles (required)
 *   theme-dark.css      — dark theme CSS variables (or define your own)
 *
 * ── QUICK START ───────────────────────────────────────────────────────────────
 *
 *   <!-- HTML -->
 *   <link rel="stylesheet" href="stickywall.css">
 *   <link rel="stylesheet" href="theme-dark.css">
 *   <div id="wall"></div>
 *
 *   // JS
 *   import { StickyWall } from './stickywall.js';
 *
 *   const wall = new StickyWall(document.getElementById('wall'), {
 *     title:    'Notes from the Class',
 *     notes:    [{ message: 'Great class!', from: 'Alice', size: 'lg' }],
 *     editable: true,
 *   });
 *
 *   wall.on('sw:add',    ({ note })           => save(note));
 *   wall.on('sw:update', ({ note, prevNote }) => persist(note));
 *   wall.on('sw:remove', ({ note })           => delete(note.id));
 *
 *   const snapshot = wall.serialize();   // current notes array (copy)
 *   wall.destroy();                      // unmount and clean up
 *
 * ── NOTE OBJECT SHAPE ─────────────────────────────────────────────────────────
 *
 *   {
 *     id:       string   — unique identifier (auto-generated UUID if omitted)
 *     label:    string   — small tag shown above the message (optional)
 *     message:  string   — main note text (required for add; defaults to '')
 *     from:     string   — attribution line at the bottom (optional)
 *     size:     'sm' | 'md' | 'lg'          — note width; default 'md'
 *     color:    'yellow'|'green'|'pink'|     — background; auto-assigned if omitted
 *               'blue'|'purple'|'red'
 *     rotation: number   — CSS rotation in degrees; auto-assigned if omitted
 *   }
 *
 * ── CONSTRUCTOR OPTIONS ───────────────────────────────────────────────────────
 *
 *   new StickyWall(el, {
 *     title:    string             — heading rendered above the wall (optional)
 *     notes:    NoteObject[]       — initial notes (default: [])
 *     editable: boolean            — show add / edit / remove controls (default: false)
 *     tape:     boolean            — tape strip pinned above each note (default: false)
 *     addForm:  'inline' | 'modal' — where the add-note form appears (default: 'inline')
 *     colors:   null | string | string[]
 *                                  — null: cycle through the built-in 6-color palette
 *                                  — string: apply one color to every note
 *                                  — array: cycle through the provided colors
 *                                    (per-note color field always overrides this)
 *     draggable: boolean           — enable drag-and-drop reordering (default: false)
 *   })
 *
 * ── PUBLIC API ────────────────────────────────────────────────────────────────
 *
 *   wall.add(note)              → NoteObject
 *     Add a note. Missing fields receive defaults. Returns the fully-resolved
 *     note (including auto-generated id). Fires sw:add.
 *
 *   wall.update(id, changes)    → void
 *     Patch a note in-place by id. Only supply the fields to change. Patches
 *     the DOM without re-rendering the wall. `id` in changes is silently
 *     ignored (id is immutable). No-op if id not found. Fires sw:update with
 *     { note, prevNote }.
 *
 *   wall.remove(id)             → void
 *     Remove a note by id. No-op if not found. Fires sw:remove.
 *
 *   wall.reset(notes)           → void
 *     Replace all notes at once. Accepts the same shape as the constructor
 *     `notes` option. Closes any open modal. Fires sw:reset with { notes }.
 *
 *   wall.get(id)                → NoteObject | null
 *     Return a copy of a single note, or null if not found. Reflects the
 *     latest state including edits made via update().
 *
 *   wall.serialize()            → NoteObject[]
 *     Return a shallow copy of the current notes array in display order.
 *     Safe to store, POST, or pass back to reset().
 *
 *   wall.toJSON()               → NoteObject[]
 *     Called automatically by JSON.stringify(wall). Same as serialize().
 *
 *   wall.on(event, fn)          → this
 *   wall.off(event, fn)         → this
 *     Subscribe / unsubscribe event handlers. Both return `this` for chaining.
 *
 *   wall.destroy()              → void
 *     Unmount the component: clears innerHTML, removes all DOM and document
 *     listeners, nulls internal refs. Safe to call multiple times (idempotent).
 *     After destroy(), add/update/remove/reset are all silent no-ops.
 *
 * ── EVENTS ───────────────────────────────────────────────────────────────────
 *
 *   sw:add      { note }              — note added (programmatic or via form)
 *   sw:update   { note, prevNote }    — note updated (programmatic or via form)
 *   sw:remove   { note }              — note removed (programmatic or via button)
 *   sw:reset    { notes }             — all notes replaced
 *   sw:reorder  { notes }             — order changed by drag-and-drop
 *
 *   All payloads are copies — mutating them has no effect on the wall.
 *   sw:reorder does not fire if the drag ends on the same position.
 *
 * ── CSS CUSTOM PROPERTIES ─────────────────────────────────────────────────────
 *
 *   Note palette (override in your theme or per-element):
 *     --sw-yellow, --sw-green, --sw-pink, --sw-blue, --sw-purple, --sw-red
 *
 *   Note dimensions:
 *     --sw-note-sm-w   (default 160px)
 *     --sw-note-md-w   (default 220px)
 *     --sw-note-lg-w   (default 300px)
 *
 *   Note text colors:
 *     --sw-note-text, --sw-note-from
 *
 *   Shadow:
 *     --sw-shadow, --sw-shadow-hover
 *
 *   Title:
 *     --sw-title
 *
 *   Empty state:
 *     --sw-empty
 *
 *   Modal (addForm:'modal'):
 *     --sw-modal-overlay, --sw-modal-bg, --sw-modal-border
 *
 *   Tape strip (tape:true):
 *     --sw-tape-bg, --sw-tape-border
 *
 *   Shared design-system variables consumed but not defined by this component
 *   (define in your app stylesheet or include theme-dark.css):
 *     --bg, --bg-input, --border, --text, --text-muted, --accent, --danger, --font-ui
 *
 * ── MIGRATION / INTEGRATION GUIDE ────────────────────────────────────────────
 *
 *   Dropping StickyWall into an existing project:
 *
 *   1. Copy the three files into your project:
 *        stickywall.js, stickywall.css, theme-dark.css
 *
 *   2. Link the stylesheets in your HTML (order matters — base before theme):
 *        <link rel="stylesheet" href="path/to/stickywall.css">
 *        <link rel="stylesheet" href="path/to/theme-dark.css">
 *
 *      If your app already defines the shared design-system variables
 *      (--bg, --text, --accent, --border, --danger, --font-ui) you only need
 *      the sw-specific overrides. In that case, skip theme-dark.css and add:
 *        --sw-yellow: ...; --sw-green: ...; (etc.)
 *
 *   3. Add a mount element anywhere in your HTML:
 *        <div id="wall"></div>
 *
 *   4. Import and instantiate:
 *        import { StickyWall } from './stickywall.js';
 *        const wall = new StickyWall(document.getElementById('wall'), options);
 *
 *   5. Persist data — listen to events and save to your backend or localStorage:
 *        wall
 *          .on('sw:add',     ({ note })    => db.create(note))
 *          .on('sw:update',  ({ note })    => db.update(note.id, note))
 *          .on('sw:remove',  ({ note })    => db.delete(note.id))
 *          .on('sw:reorder', ({ notes })   => db.saveOrder(notes.map(n => n.id)));
 *
 *   6. Restore state on page load — pass saved notes to the constructor or reset():
 *        const saved = await db.fetchNotes();
 *        wall.reset(saved);             // or pass as options.notes at construction
 *
 *   Rebuilding vs. resetting:
 *     Most option changes (tape, addForm, colors, draggable) require a rebuild
 *     because they affect the rendered HTML structure. The recommended pattern is:
 *       - Keep a reference to the current options
 *       - Call wall.destroy() to unmount
 *       - Construct a new StickyWall with updated options and wall.serialize() as notes
 *
 *   npm package:
 *     import { StickyWall } from '@archerjb/ui-components/stickywall';
 *     // CSS subpath exports:
 *     //   @archerjb/ui-components/stickywall/css
 *     //   @archerjb/ui-components/stickywall/theme-dark
 */

const COLORS    = ['yellow', 'green', 'pink', 'blue', 'purple', 'red'];
const ROTATIONS = [-5, 2, -2, 5, 1, -3, 4, 0, -4, 3, -1, -5, 2, -2, 5];

// crypto.randomUUID exists only in a secure context; over plain http it is undefined.
function uuid() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();

    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.random() * 256 | 0;
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}


// ── StickyWall ────────────────────────────────────────────────────────────────

export class StickyWall {
    #el;
    #opts;
    #notes;
    #wall;
    #handlers    = {};
    #escHandler  = null;  // document keydown listener for modal Escape
    #destroyed   = false;
    // modal element refs — populated by #bindModalForm(), null when addForm:'inline'
    #modal        = null;
    #modalLabel   = null;
    #modalMsg     = null;
    #modalFrom    = null;
    #modalTitle   = null;
    #modalSubmit  = null;
    #editingId    = null;  // null → add mode; string id → editing that note
    #modalTrapFn  = null;  // Tab focus-trap listener, removed on close/destroy
    #dragId           = null;  // id of note currently being dragged
    #dropTarget       = null;  // { id, position } of the current drop indicator
    #editEscFns       = new WeakMap(); // escape handlers for inline edit, keyed by note element
    #touchMoveHandler = null;
    #touchEndHandler  = null;

    /**
     * @param {HTMLElement} el      - Mount element. Its contents are replaced.
     * @param {object}      options
     * @param {string}      [options.title]    - Section heading text.
     * @param {object[]}    [options.notes]    - Initial notes array.
     * @param {boolean}     [options.editable]           - Show add/edit/remove controls.
     * @param {boolean}     [options.tape]               - Tape strip at top of each note.
     * @param {'inline'|'modal'} [options.addForm]       - Where the add-note form appears.
     */
    constructor(el, options = {}) {
        this.#el   = el;
        this.#opts = { title: '', notes: [], editable: false, tape: false, addForm: 'inline', colors: null, draggable: false, ...options };
        this.#notes = this.#opts.notes.map((n, i) => this.#normalize(n, i));
        this.#render();
    }


    // ── Public API ────────────────────────────────────────────────────────────

    /** Subscribe to a component event. Returns `this` for chaining. */
    on(event, fn) {
        (this.#handlers[event] ??= []).push(fn);
        return this;
    }

    /** Returns a copy of a single note by id, or null if not found. */
    get(id) {
        const note = this.#notes.find(n => n.id === id);
        return note ? { ...note } : null;
    }

    /** Unsubscribe a specific handler. Returns `this` for chaining. */
    off(event, fn) {
        if (this.#handlers[event]) {
            this.#handlers[event] = this.#handlers[event].filter(h => h !== fn);
        }
        return this;
    }

    /**
     * Add a note. Missing fields are filled with defaults.
     * Returns the fully-resolved note object (including generated id).
     */
    add(note = {}) {
        if (!this.#wall) return null;
        const n = this.#normalize(note, this.#notes.length);
        this.#notes.push(n);
        this.#appendNote(n);
        this.#syncEmpty();
        this.#emit('sw:add', { note: n });
        return n;
    }

    /**
     * Update a note in-place by id. Only supply the fields you want to change.
     * Patches the DOM without re-rendering the whole wall.
     * Fires sw:update with { note, prevNote }.
     * No-op if id is not found.
     */
    update(id, changes = {}) {
        if (!this.#wall) return;
        const idx = this.#notes.findIndex(n => n.id === id);
        if (idx === -1) return;

        const prevNote = { ...this.#notes[idx] };
        // id is immutable — strip it from changes if accidentally included
        const { id: _dropped, ...safeChanges } = changes;
        this.#notes[idx] = { ...prevNote, ...safeChanges };

        const noteEl = this.#wall.querySelector(`[data-sw-id="${CSS.escape(id)}"]`);
        if (noteEl) {
            if (safeChanges.label !== undefined) {
                let labelEl = noteEl.querySelector('.sw-note__label');
                if (safeChanges.label) {
                    if (labelEl) { labelEl.textContent = safeChanges.label; }
                    else {
                        labelEl = document.createElement('p');
                        labelEl.className = 'sw-note__label';
                        labelEl.textContent = safeChanges.label;
                        noteEl.insertBefore(labelEl, noteEl.firstChild);
                    }
                } else { labelEl?.remove(); }
            }
            if (safeChanges.message !== undefined) {
                noteEl.querySelector('.sw-note__msg').textContent = safeChanges.message;
            }
            if (safeChanges.from !== undefined) {
                let fromEl = noteEl.querySelector('.sw-note__from');
                if (safeChanges.from) {
                    if (fromEl) { fromEl.textContent = `— ${safeChanges.from}`; }
                    else {
                        fromEl = document.createElement('p');
                        fromEl.className = 'sw-note__from';
                        fromEl.textContent = `— ${safeChanges.from}`;
                        noteEl.querySelector('.sw-note__msg').insertAdjacentElement('afterend', fromEl);
                    }
                } else { fromEl?.remove(); }
            }
            if (safeChanges.color) {
                COLORS.forEach(c => noteEl.classList.remove(`sw-note--${c}`));
                noteEl.classList.add(`sw-note--${safeChanges.color}`);
            }
            if (safeChanges.size) {
                ['sm', 'md', 'lg'].forEach(s => noteEl.classList.remove(`sw-note--${s}`));
                noteEl.classList.add(`sw-note--${safeChanges.size}`);
            }
            if (safeChanges.rotation !== undefined) {
                noteEl.style.transform = `rotate(${safeChanges.rotation}deg)`;
            }
        }

        this.#emit('sw:update', { note: this.#notes[idx], prevNote });
    }

    /** Remove a note by id. No-op if not found. */
    remove(id) {
        if (!this.#wall) return;
        const idx = this.#notes.findIndex(n => n.id === id);
        if (idx === -1) return;
        const [note] = this.#notes.splice(idx, 1);
        this.#wall.querySelector(`[data-sw-id="${CSS.escape(id)}"]`)?.remove();
        this.#syncEmpty();
        this.#emit('sw:remove', { note });
    }

    /** Replace all notes. Fires sw:reset with the full new notes array. */
    reset(notes = []) {
        if (!this.#wall) return;
        if (this.#modal && !this.#modal.classList.contains('sw-modal--hidden')) this.#closeModal();
        this.#notes = notes.map((n, i) => this.#normalize(n, i));
        this.#wall.innerHTML = '';
        this.#notes.forEach(n => this.#appendNote(n));
        this.#syncEmpty();
        this.#emit('sw:reset', { notes: this.#notes.map(n => ({ ...n })) });
    }

    /** Returns a shallow copy of the current notes array. Safe to serialize. */
    serialize() {
        return this.#notes.map(n => ({ ...n }));
    }

    /** Called by JSON.stringify automatically — enables `JSON.stringify(wall)`. */
    toJSON() {
        return this.serialize();
    }

    /** Unmount the component: removes DOM, clears listeners, cleans up globals. */
    destroy() {
        if (this.#destroyed) return;
        this.#destroyed = true;
        if (this.#escHandler) {
            document.removeEventListener('keydown', this.#escHandler);
            this.#escHandler = null;
        }
        if (this.#modalTrapFn && this.#modal) {
            this.#modal.removeEventListener('keydown', this.#modalTrapFn);
            this.#modalTrapFn = null;
        }
        if (this.#touchMoveHandler) {
            document.removeEventListener('touchmove',   this.#touchMoveHandler);
            document.removeEventListener('touchend',    this.#touchEndHandler);
            document.removeEventListener('touchcancel', this.#touchEndHandler);
            this.#touchMoveHandler = null;
            this.#touchEndHandler  = null;
        }
        this.#el.innerHTML = '';
        this.#el.classList.remove('sw-root', 'sw-root--tape', 'sw-dragging-active');
        this.#notes      = [];
        this.#handlers   = {};
        this.#wall       = null;
        this.#dropTarget = null;
        this.#dragId     = null;
        this.#modal       = null;
        this.#modalLabel  = null;
        this.#modalMsg    = null;
        this.#modalFrom   = null;
        this.#modalTitle  = null;
        this.#modalSubmit = null;
        this.#editingId   = null;
        this.#modalTrapFn = null;
    }


    // ── Private ───────────────────────────────────────────────────────────────

    #normalize(note, idx) {
        return {
            id:       note.id       ?? uuid(),
            label:    note.label    ?? '',
            message:  note.message  ?? '',
            from:     note.from     ?? '',
            size:     note.size     ?? 'md',
            color:    note.color    ?? this.#pickColor(idx),
            rotation: note.rotation ?? ROTATIONS[idx % ROTATIONS.length],
        };
    }

    #pickColor(idx) {
        const c = this.#opts.colors;
        if (Array.isArray(c) && c.length > 0) return c[idx % c.length];
        if (typeof c === 'string')             return c;
        return COLORS[idx % COLORS.length];
    }

    #emit(event, data) {
        this.#handlers[event]?.forEach(fn => fn(data));
    }

    #render() {
        this.#el.classList.add('sw-root');
        this.#el.classList.toggle('sw-root--tape', !!this.#opts.tape);
        this.#el.innerHTML = `
            ${this.#opts.title ? `<h3 class="sw-title">${esc(this.#opts.title)}</h3>` : ''}
            <div class="sw-wall"></div>
            ${this.#opts.editable ? this.#addFormHTML() : ''}
        `;
        this.#wall = this.#el.querySelector('.sw-wall');
        this.#notes.forEach(n => this.#appendNote(n));
        this.#syncEmpty();
        if (this.#opts.editable)  this.#bindAddForm();
        if (this.#opts.draggable) this.#bindDraggable();
    }

    #syncEmpty() {
        let empty = this.#wall.querySelector('.sw-wall__empty');
        if (this.#notes.length === 0) {
            if (!empty) {
                empty = document.createElement('p');
                empty.className = 'sw-wall__empty';
                empty.textContent = 'No notes yet.';
                this.#wall.appendChild(empty);
            }
        } else {
            empty?.remove();
        }
    }

    #appendNote(note) {
        const el = document.createElement('div');
        el.className = `sw-note sw-note--${note.size} sw-note--${note.color}`;
        el.dataset.swId = note.id;
        el.style.transform = `rotate(${note.rotation}deg)`;
        el.innerHTML = `
            ${note.label ? `<p class="sw-note__label">${esc(note.label)}</p>` : ''}
            <p class="sw-note__msg">${esc(note.message)}</p>
            ${note.from ? `<p class="sw-note__from">— ${esc(note.from)}</p>` : ''}
            ${this.#opts.editable ? `
                <button class="sw-note__edit"   aria-label="Edit note"   title="Edit">✎</button>
                <button class="sw-note__remove" aria-label="Remove note" title="Remove">×</button>
            ` : ''}
        `;
        if (this.#opts.editable) {
            el.querySelector('.sw-note__remove').addEventListener('click', () => this.remove(note.id));
            el.querySelector('.sw-note__edit').addEventListener('click',   () => this.#enterEdit(el, note.id));
        }
        if (this.#opts.draggable) {
            el.setAttribute('draggable', 'true');
            el.addEventListener('dragstart',  e  => this.#onDragStart(e, note.id));
            el.addEventListener('dragend',    ()  => this.#onDragEnd());
            el.addEventListener('touchstart', e  => this.#onTouchStart(e, note.id), { passive: true });
        }
        this.#wall.appendChild(el);
    }

    // ── Edit mode ─────────────────────────────────────────────────────────────

    #enterEdit(noteEl, noteId) {
        if (this.#opts.addForm === 'modal') {
            this.#openModal(noteId);
            return;
        }
        if (noteEl.classList.contains('sw-note--editing')) return;
        noteEl.classList.add('sw-note--editing');

        const note = this.#notes.find(n => n.id === noteId);

        const form = document.createElement('form');
        form.className  = 'sw-note__edit-form';
        form.noValidate = true;

        const labelInput = document.createElement('input');
        labelInput.className   = 'sw-note__edit-label';
        labelInput.type        = 'text';
        labelInput.value       = note.label;
        labelInput.placeholder = 'Label (optional)';

        const textarea = document.createElement('textarea');
        textarea.className = 'sw-note__edit-msg';
        textarea.rows      = 3;
        textarea.value     = note.message;

        const fromInput = document.createElement('input');
        fromInput.className = 'sw-note__edit-from';
        fromInput.type      = 'text';
        fromInput.value     = note.from;

        const actions   = document.createElement('div');
        actions.className = 'sw-note__edit-actions';

        const saveBtn = document.createElement('button');
        saveBtn.type      = 'submit';
        saveBtn.className = 'sw-note__save';
        saveBtn.textContent = 'Save';

        const cancelBtn = document.createElement('button');
        cancelBtn.type        = 'button';
        cancelBtn.className   = 'sw-note__cancel-edit';
        cancelBtn.textContent = 'Cancel';

        actions.append(saveBtn, cancelBtn);
        form.append(labelInput, textarea, fromInput, actions);
        noteEl.appendChild(form);

        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

        const cancel = () => this.#exitEdit(noteEl, noteId, null);

        form.addEventListener('submit', e => {
            e.preventDefault();
            this.#exitEdit(noteEl, noteId, { label: labelInput.value, message: textarea.value, from: fromInput.value });
        });
        cancelBtn.addEventListener('click', cancel);

        const escFn = e => { if (e.key === 'Escape') cancel(); };
        noteEl.addEventListener('keydown', escFn);
        this.#editEscFns.set(noteEl, escFn);
    }

    #exitEdit(noteEl, noteId, newData) {
        const escFn = this.#editEscFns.get(noteEl);
        if (escFn) {
            noteEl.removeEventListener('keydown', escFn);
            this.#editEscFns.delete(noteEl);
        }

        if (newData !== null) {
            const message = newData.message.trim();
            if (!message) {
                // Empty message: keep the form open, re-focus
                noteEl.querySelector('.sw-note__edit-msg')?.focus();
                return;
            }
            this.update(noteId, { label: newData.label.trim(), message, from: newData.from.trim() });
        }

        noteEl.querySelector('.sw-note__edit-form')?.remove();
        noteEl.classList.remove('sw-note--editing');
    }

    // ── Drag-and-drop reordering ──────────────────────────────────────────────

    #bindDraggable() {
        this.#wall.addEventListener('dragover',  e => this.#onDragOver(e));
        this.#wall.addEventListener('drop',      e => this.#onDrop(e));
        this.#wall.addEventListener('dragleave', e => this.#onDragLeave(e));
    }

    #onDragStart(e, id) {
        this.#dragId = id;
        const noteEl = this.#wall.querySelector(`[data-sw-id="${CSS.escape(id)}"]`);
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            const rect = noteEl.getBoundingClientRect();
            e.dataTransfer.setDragImage(noteEl, e.clientX - rect.left, e.clientY - rect.top);
        }
        noteEl.classList.add('sw-note--dragging');
        this.#el.classList.add('sw-dragging-active');
    }

    #onDragEnd() {
        if (this.#dragId) {
            this.#wall.querySelector(`[data-sw-id="${CSS.escape(this.#dragId)}"]`)
                ?.classList.remove('sw-note--dragging');
        }
        this.#clearDropIndicator();
        this.#el.classList.remove('sw-dragging-active');
        this.#dragId = null;
    }

    #onDragOver(e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const noteEl = e.target.closest?.('.sw-note');
        if (!noteEl || noteEl.dataset.swId === this.#dragId) {
            this.#clearDropIndicator();
            return;
        }
        const rect     = noteEl.getBoundingClientRect();
        const position = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
        this.#setDropIndicator(noteEl.dataset.swId, position);
    }

    #onDragLeave(e) {
        if (!this.#wall.contains(e.relatedTarget)) this.#clearDropIndicator();
    }

    #onDrop(e) {
        e.preventDefault();
        this.#commitReorder();
    }

    // ── Touch drag-and-drop ───────────────────────────────────────────────────

    #onTouchStart(e, id) {
        this.#dragId = id;
        this.#wall.querySelector(`[data-sw-id="${CSS.escape(id)}"]`)
            ?.classList.add('sw-note--dragging');
        this.#el.classList.add('sw-dragging-active');

        this.#touchMoveHandler = ev => this.#onTouchMove(ev);
        this.#touchEndHandler  = ()  => this.#onTouchEnd();
        document.addEventListener('touchmove',   this.#touchMoveHandler, { passive: false });
        document.addEventListener('touchend',    this.#touchEndHandler);
        document.addEventListener('touchcancel', this.#touchEndHandler);
    }

    #onTouchMove(e) {
        e.preventDefault();
        if (!this.#dragId) return;
        const touch  = e.touches[0];
        const dragEl = this.#wall.querySelector(`[data-sw-id="${CSS.escape(this.#dragId)}"]`);
        // Hide the dragged note so elementFromPoint sees what's beneath it
        dragEl.style.visibility = 'hidden';
        const under  = document.elementFromPoint(touch.clientX, touch.clientY);
        dragEl.style.visibility = '';
        const noteEl = under?.closest?.('.sw-note');
        if (!noteEl || !this.#wall.contains(noteEl) || noteEl.dataset.swId === this.#dragId) {
            this.#clearDropIndicator();
            return;
        }
        const rect     = noteEl.getBoundingClientRect();
        const position = touch.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
        this.#setDropIndicator(noteEl.dataset.swId, position);
    }

    #onTouchEnd() {
        document.removeEventListener('touchmove',   this.#touchMoveHandler);
        document.removeEventListener('touchend',    this.#touchEndHandler);
        document.removeEventListener('touchcancel', this.#touchEndHandler);
        this.#touchMoveHandler = null;
        this.#touchEndHandler  = null;

        const prevDragId = this.#dragId;
        this.#commitReorder();
        // Ensure cleanup for cancel/no-op paths (commitReorder returned early)
        this.#el.classList.remove('sw-dragging-active');
        if (prevDragId) {
            this.#wall.querySelector(`[data-sw-id="${CSS.escape(prevDragId)}"]`)
                ?.classList.remove('sw-note--dragging');
        }
        this.#dragId = null;
    }

    // ── Shared reorder commit (mouse drop + touch end) ────────────────────────

    #commitReorder() {
        if (!this.#dropTarget || !this.#dragId) { this.#clearDropIndicator(); return; }

        const { id: targetId, position } = this.#dropTarget;
        this.#clearDropIndicator();

        const fromIdx = this.#notes.findIndex(n => n.id === this.#dragId);
        let   toIdx   = this.#notes.findIndex(n => n.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;

        if (position === 'after') toIdx++;
        const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;

        this.#el.classList.remove('sw-dragging-active');
        this.#wall.querySelector(`[data-sw-id="${CSS.escape(this.#dragId)}"]`)
            ?.classList.remove('sw-note--dragging');

        if (fromIdx === insertIdx) { this.#dragId = null; return; }

        const [note] = this.#notes.splice(fromIdx, 1);
        this.#notes.splice(insertIdx, 0, note);

        const noteEl   = this.#wall.querySelector(`[data-sw-id="${CSS.escape(note.id)}"]`);
        const nextNote = this.#notes[insertIdx + 1];
        const refEl    = nextNote
            ? this.#wall.querySelector(`[data-sw-id="${CSS.escape(nextNote.id)}"]`)
            : null;
        this.#wall.insertBefore(noteEl, refEl);

        this.#dragId = null;
        this.#emit('sw:reorder', { notes: this.#notes.map(n => ({ ...n })) });
    }

    #setDropIndicator(id, position) {
        if (this.#dropTarget?.id === id && this.#dropTarget?.position === position) return;
        this.#clearDropIndicator();
        this.#dropTarget = { id, position };
        this.#wall.querySelector(`[data-sw-id="${CSS.escape(id)}"]`)
            ?.classList.add(`sw-note--drop-${position}`);
    }

    #clearDropIndicator() {
        if (!this.#dropTarget) return;
        this.#wall.querySelector(`[data-sw-id="${CSS.escape(this.#dropTarget.id)}"]`)
            ?.classList.remove('sw-note--drop-before', 'sw-note--drop-after');
        this.#dropTarget = null;
    }

    // ── Form HTML + binding ───────────────────────────────────────────────────

    #formFieldsHTML() {
        return `
            <input    class="sw-add__label" type="text" placeholder="Label (optional)">
            <textarea class="sw-add__msg"   placeholder="Your message…" rows="3"></textarea>
            <input    class="sw-add__from"  type="text" placeholder="From (name)">
            <div class="sw-add__actions">
                <button type="submit"  class="sw-add__submit">Add</button>
                <button type="button"  class="sw-add__cancel">Cancel</button>
            </div>
        `;
    }

    #addFormHTML() {
        if (this.#opts.addForm === 'modal') {
            return `
                <div class="sw-add">
                    <button class="sw-add__toggle" type="button">+ Add Note</button>
                </div>
                <div class="sw-modal sw-modal--hidden" role="dialog" aria-modal="true" aria-label="Add note">
                    <div class="sw-modal__card">
                        <div class="sw-modal__header">
                            <span class="sw-modal__title">Add a note</span>
                            <button class="sw-modal__close" type="button" aria-label="Close">×</button>
                        </div>
                        <form class="sw-add__form" novalidate>${this.#formFieldsHTML()}</form>
                    </div>
                </div>
            `;
        }

        // 'inline' (default)
        return `
            <div class="sw-add">
                <button class="sw-add__toggle" type="button">+ Add Note</button>
                <form class="sw-add__form sw-add__form--hidden" novalidate>${this.#formFieldsHTML()}</form>
            </div>
        `;
    }

    #bindAddForm() {
        if (this.#opts.addForm === 'modal') {
            this.#bindModalForm();
        } else {
            this.#bindInlineForm();
        }
    }

    #bindInlineForm() {
        const toggle = this.#el.querySelector('.sw-add__toggle');
        const form   = this.#el.querySelector('.sw-add__form');
        const cancel = this.#el.querySelector('.sw-add__cancel');
        const label  = this.#el.querySelector('.sw-add__label');
        const msg    = this.#el.querySelector('.sw-add__msg');
        const from   = this.#el.querySelector('.sw-add__from');

        const open  = () => { form.classList.remove('sw-add__form--hidden'); toggle.classList.add('sw-add__toggle--active'); msg.focus(); };
        const close = () => { form.classList.add('sw-add__form--hidden'); toggle.classList.remove('sw-add__toggle--active'); label.value = ''; msg.value = ''; from.value = ''; };

        toggle.addEventListener('click', () =>
            form.classList.contains('sw-add__form--hidden') ? open() : close()
        );
        cancel.addEventListener('click', close);

        form.addEventListener('submit', e => {
            e.preventDefault();
            const message = msg.value.trim();
            if (!message) { msg.focus(); return; }
            this.add({ label: label.value.trim(), message, from: from.value.trim() });
            close();
        });
    }

    #bindModalForm() {
        this.#modal       = this.#el.querySelector('.sw-modal');
        this.#modalLabel  = this.#el.querySelector('.sw-add__label');
        this.#modalMsg    = this.#el.querySelector('.sw-add__msg');
        this.#modalFrom   = this.#el.querySelector('.sw-add__from');
        this.#modalTitle  = this.#el.querySelector('.sw-modal__title');
        this.#modalSubmit = this.#el.querySelector('.sw-add__submit');

        const toggle   = this.#el.querySelector('.sw-add__toggle');
        const closeBtn = this.#el.querySelector('.sw-modal__close');
        const cancel   = this.#el.querySelector('.sw-add__cancel');
        const form     = this.#el.querySelector('.sw-add__form');

        toggle.addEventListener('click', () => this.#openModal(null));
        closeBtn.addEventListener('click', () => this.#closeModal());
        cancel.addEventListener('click', () => this.#closeModal());

        // Backdrop click — only when clicking the overlay itself, not the card
        this.#modal.addEventListener('click', e => { if (e.target === this.#modal) this.#closeModal(); });

        form.addEventListener('submit', e => {
            e.preventDefault();
            const message = this.#modalMsg.value.trim();
            if (!message) { this.#modalMsg.focus(); return; }
            const label = this.#modalLabel.value.trim();
            const from  = this.#modalFrom.value.trim();
            if (this.#editingId !== null) {
                this.update(this.#editingId, { label, message, from });
            } else {
                this.add({ label, message, from });
            }
            this.#closeModal();
        });
    }

    #openModal(noteId = null) {
        this.#editingId = noteId;
        if (noteId !== null) {
            const note = this.#notes.find(n => n.id === noteId);
            this.#modalLabel.value        = note.label;
            this.#modalMsg.value          = note.message;
            this.#modalFrom.value         = note.from;
            this.#modalTitle.textContent  = 'Edit note';
            this.#modalSubmit.textContent = 'Save';
            this.#modal.setAttribute('aria-label', 'Edit note');
        } else {
            this.#modalLabel.value        = '';
            this.#modalMsg.value          = '';
            this.#modalFrom.value         = '';
            this.#modalTitle.textContent  = 'Add a note';
            this.#modalSubmit.textContent = 'Add';
            this.#modal.setAttribute('aria-label', 'Add note');
        }
        this.#modal.classList.remove('sw-modal--hidden');
        this.#modalMsg.focus();

        this.#escHandler = e => { if (e.key === 'Escape') this.#closeModal(); };
        document.addEventListener('keydown', this.#escHandler);

        // Focus trap: keep Tab/Shift+Tab inside the modal card
        const card      = this.#modal.querySelector('.sw-modal__card');
        const focusable = () => [...card.querySelectorAll('button, input, textarea')].filter(el => !el.disabled);
        this.#modalTrapFn = e => {
            if (e.key !== 'Tab') return;
            const els = focusable();
            if (!els.length) return;
            const first = els[0], last = els[els.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) { e.preventDefault(); last.focus(); }
            } else {
                if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
            }
        };
        this.#modal.addEventListener('keydown', this.#modalTrapFn);
    }

    #closeModal() {
        this.#modal.classList.add('sw-modal--hidden');
        this.#modalLabel.value        = '';
        this.#modalMsg.value          = '';
        this.#modalFrom.value         = '';
        this.#editingId               = null;
        this.#modalTitle.textContent  = 'Add a note';
        this.#modalSubmit.textContent = 'Add';
        this.#modal.setAttribute('aria-label', 'Add note');
        if (this.#escHandler) {
            document.removeEventListener('keydown', this.#escHandler);
            this.#escHandler = null;
        }
        if (this.#modalTrapFn) {
            this.#modal.removeEventListener('keydown', this.#modalTrapFn);
            this.#modalTrapFn = null;
        }
    }
}
