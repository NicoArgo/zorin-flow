// Contorno colorido em volta das janelas do terminal, na cor da regra da pasta
// da aba ativa (a mesma cor da bolinha do applet).
//
// O contorno é um filho do próprio MetaWindowActor: move, redimensiona,
// minimiza, troca de área de trabalho e fica na mesma ordem de empilhamento que
// a janela, sem nenhuma sincronização manual. Fica por fora da borda visível
// (dentro da margem de sombra das janelas com decoração do cliente); com a
// janela maximizada vai para dentro, para não sair da tela. Em tela cheia some.
//
// No terminal em foco aparece também o botão "Regra da pasta" (canto inferior
// direito): mostra a cor e o nome da regra da pasta da aba ativa e abre o
// diálogo do zflow-rule para ela. Só no terminal em foco porque, no X11, o
// clique sobre uma janela vai para o app; a área do botão é registrada no Shell
// (trackChrome) e não pode ficar valendo atrás de outras janelas.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {PRESENCE_DIR, isTerminal, readPresence} from './terminals.js';

const UNFOCUSED_OPACITY = 150;
const BADGE_IDLE_OPACITY = 120;
const BADGE_MARGIN = 10;
const ZFLOW_RULE = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'zflow-rule']);

function editRule(cwd) {
    try {
        Gio.Subprocess.new([ZFLOW_RULE, 'edit', cwd], Gio.SubprocessFlags.NONE);
    } catch (e) {
        Main.notifyError('Zorin Flow', `Não foi possível abrir a regra da pasta: ${e.message}`);
    }
}

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
        this._settingsIds = ['terminal-borders', 'terminal-rule-button',
            'terminal-border-width', 'terminal-border-radius'].map(key =>
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

        const badge = this._makeBadge(win);
        actor.add_child(badge.button);
        Main.layoutManager.trackChrome(badge.button, {affectsInputRegion: true});

        const update = () => this._update(win);
        const entry = {
            widget,
            badge,
            actor,
            ids: [
                win.connect('size-changed', update),
                // A área de clique do botão só se refaz sozinha quando ele muda
                // de tamanho; mover a janela também precisa refazê-la.
                win.connect('position-changed', () => {
                    if (badge.button.visible)
                        Main.layoutManager._queueUpdateRegions();
                }),
                win.connect('notify::title', update),
                win.connect('notify::fullscreen', update),
                win.connect('notify::minimized', update),
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
        Main.layoutManager.untrackChrome(entry.badge.button);
        entry.badge.button.destroy();
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

    _makeBadge(win) {
        const dot = new St.Widget({style_class: 'zf-badge-dot', y_align: Clutter.ActorAlign.CENTER});
        const label = new St.Label({style_class: 'zf-badge-label', y_align: Clutter.ActorAlign.CENTER});
        const icon = new St.Icon({icon_name: 'document-edit-symbolic', icon_size: 14, y_align: Clutter.ActorAlign.CENTER});
        const box = new St.BoxLayout({style_class: 'zf-badge-box'});
        box.add_child(dot);
        box.add_child(label);
        box.add_child(icon);
        const button = new St.Button({
            style_class: 'zf-badge',
            child: box,
            reactive: true,
            track_hover: true,
            visible: false,
            opacity: BADGE_IDLE_OPACITY,
            accessible_name: 'Regra da pasta',
        });
        button.connect('notify::hover', () => {
            button.opacity = button.hover ? 255 : BADGE_IDLE_OPACITY;
        });
        button.connect('clicked', () => {
            const p = this._presenceFor(win);
            if (p?.cwd)
                editRule(p.cwd);
        });
        return {button, dot, label};
    }

    _presenceFor(win) {
        const title = win.get_title() ?? '';
        return this._presence.find(p => p.title === title) ?? null;
    }

    _update(win) {
        const entry = this._borders.get(win);
        if (!entry)
            return;
        const p = this._presenceFor(win);
        const accent = p?.accent;
        const focused = win === global.display.focus_window;
        const frame = win.get_frame_rect();
        const buffer = win.get_buffer_rect();
        const fx = frame.x - buffer.x;
        const fy = frame.y - buffer.y;

        // Contorno.
        const {widget} = entry;
        if (!accent || win.fullscreen || !this._settings.get_boolean('terminal-borders')) {
            widget.hide();
        } else {
            const width = this._settings.get_int('terminal-border-width');
            const maximized = win.get_maximized() === Meta.MaximizeFlags.BOTH;
            const radius = maximized ? 0 : this._settings.get_int('terminal-border-radius');
            const out = maximized ? 0 : width;
            widget.set_position(fx - out, fy - out);
            widget.set_size(frame.width + 2 * out, frame.height + 2 * out);
            widget.set_style(`border: ${width}px solid ${accent}; border-radius: ${radius + out}px;`);
            widget.opacity = focused ? 255 : UNFOCUSED_OPACITY;
            widget.show();
        }

        // Botão "Regra da pasta" (só no terminal em foco, com o hook ativo).
        const {button, dot, label} = entry.badge;
        if (!p?.cwd || !focused || win.fullscreen || win.minimized ||
            !this._settings.get_boolean('terminal-rule-button')) {
            button.hide();
            return;
        }
        label.text = p.name || 'Regra da pasta';
        if (accent) {
            dot.set_style(`background-color: ${accent};`);
            dot.remove_style_class_name('zf-badge-dot-empty');
        } else {
            dot.set_style(null);
            dot.add_style_class_name('zf-badge-dot-empty');
        }
        button.show();
        const [, natW] = button.get_preferred_width(-1);
        const [, natH] = button.get_preferred_height(natW);
        button.set_position(fx + frame.width - natW - BADGE_MARGIN, fy + frame.height - natH - BADGE_MARGIN);
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
