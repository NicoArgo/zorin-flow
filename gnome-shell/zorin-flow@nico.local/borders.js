// Contorno colorido em volta das janelas do terminal, na cor da regra da pasta
// da aba ativa (a mesma cor da bolinha do applet).
//
// O contorno é um filho do próprio MetaWindowActor: move, redimensiona,
// minimiza, troca de área de trabalho e fica na mesma ordem de empilhamento que
// a janela, sem nenhuma sincronização manual. Fica por fora da borda visível
// (dentro da margem de sombra das janelas com decoração do cliente); com a
// janela maximizada vai para dentro, para não sair da tela. Em tela cheia some.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {PRESENCE_DIR, isTerminal, readPresence} from './terminals.js';

const UNFOCUSED_OPACITY = 150;

export class TerminalBorders {
    constructor(settings) {
        this._settings = settings;
        this._borders = new Map(); // MetaWindow -> {widget, actor, ids, actorId}

        GLib.mkdir_with_parents(PRESENCE_DIR, 0o700);
        this._presence = readPresence();
        this._monitor = Gio.File.new_for_path(PRESENCE_DIR).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => this._queueReload());

        this._displaySignals = [
            global.display.connect('window-created', (_d, win) => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._track(win);
                    return GLib.SOURCE_REMOVE;
                });
            }),
            global.display.connect('notify::focus-window', () => this._updateAll()),
        ];
        this._settingsIds = ['terminal-border-width', 'terminal-border-radius'].map(key =>
            settings.connect(`changed::${key}`, () => this._updateAll()));

        for (const actor of global.get_window_actors())
            this._track(actor.meta_window);
    }

    _track(win) {
        if (!win || this._borders.has(win) || !isTerminal(win))
            return;
        const actor = win.get_compositor_private();
        if (!actor)
            return;

        const widget = new St.Widget({style_class: 'zf-term-border', reactive: false, visible: false});
        actor.add_child(widget);

        const update = () => this._update(win);
        const entry = {
            widget,
            actor,
            ids: [
                win.connect('size-changed', update),
                win.connect('notify::title', update),
                win.connect('notify::fullscreen', update),
                win.connect('notify::maximized-horizontally', update),
                win.connect('notify::maximized-vertically', update),
                win.connect('unmanaged', () => this._untrack(win)),
            ],
            actorId: actor.connect('destroy', () => this._untrack(win)),
        };
        this._borders.set(win, entry);
        this._update(win);
    }

    _untrack(win) {
        const entry = this._borders.get(win);
        if (!entry)
            return;
        this._borders.delete(win);
        for (const id of entry.ids)
            win.disconnect(id);
        entry.actor.disconnect(entry.actorId);
        entry.widget.destroy();
    }

    _queueReload() {
        if (this._reloadId)
            return;
        this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            this._reloadId = 0;
            this._presence = readPresence();
            this._updateAll();
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateAll() {
        for (const win of this._borders.keys())
            this._update(win);
    }

    _update(win) {
        const entry = this._borders.get(win);
        if (!entry)
            return;
        const {widget} = entry;
        const title = win.get_title() ?? '';
        const accent = this._presence.find(p => p.title === title)?.accent;

        if (!accent || win.fullscreen) {
            widget.hide();
            return;
        }

        const width = this._settings.get_int('terminal-border-width');
        const maximized = win.get_maximized() === Meta.MaximizeFlags.BOTH;
        const radius = maximized ? 0 : this._settings.get_int('terminal-border-radius');

        // Posição relativa ao actor: a borda visível (frame) dentro do buffer,
        // que inclui a margem de sombra das janelas com CSD.
        const frame = win.get_frame_rect();
        const buffer = win.get_buffer_rect();
        const out = maximized ? 0 : width;
        widget.set_position(frame.x - buffer.x - out, frame.y - buffer.y - out);
        widget.set_size(frame.width + 2 * out, frame.height + 2 * out);
        widget.set_style(`border: ${width}px solid ${accent}; border-radius: ${radius + out}px;`);
        widget.opacity = win === global.display.focus_window ? 255 : UNFOCUSED_OPACITY;
        widget.show();
    }

    destroy() {
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._monitor.cancel();
        for (const id of this._displaySignals)
            global.display.disconnect(id);
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        for (const win of [...this._borders.keys()])
            this._untrack(win);
        this._settings = null;
    }
}
