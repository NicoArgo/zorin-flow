// Terminais no painel:  [>_]  e  ● ● ●  (dois itens independentes)
//
// O botão abre um terminal novo; cada bolinha é uma janela do GNOME Terminal,
// na cor da regra da pasta em que a aba ativa dela está. A cor vem dos arquivos
// de presença que o hook de bash (shell/zflow.bash) escreve em
// $XDG_RUNTIME_DIR/zorin-flow/terminals/<pid>.json; a ligação arquivo ↔ janela é
// pelo título, que o próprio hook definiu. A única ação é trazer a janela para
// frente, então um empate de títulos no pior caso foca o terminal irmão.
//
// As bolinhas têm posição fixa (ordem de abertura): focar uma janela não
// reordena nada, igual ao Alt+Tab do POP Flow.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {PanelItem, iconButton} from './item.js';

const MAX_DOTS = 8;
const TERMINAL_APP = 'org.gnome.Terminal.desktop';
export const PRESENCE_DIR = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'zorin-flow', 'terminals']);

export function isTerminal(win) {
    if (win.get_window_type() !== Meta.WindowType.NORMAL)
        return false;
    const cls = `${win.get_wm_class() ?? ''} ${win.get_wm_class_instance() ?? ''}`.toLowerCase();
    return cls.includes('gnome-terminal');
}

export function readPresence() {
    const list = [];
    const dir = Gio.File.new_for_path(PRESENCE_DIR);
    let iter;
    try {
        iter = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return list;
    }
    const decoder = new TextDecoder();
    let info;
    while ((info = iter.next_file(null))) {
        const name = info.get_name();
        if (!name.endsWith('.json'))
            continue;
        const file = dir.get_child(name);
        try {
            const [, bytes] = file.load_contents(null);
            const p = JSON.parse(decoder.decode(bytes));
            if (!GLib.file_test(`/proc/${p.pid}`, GLib.FileTest.EXISTS)) {
                // O shell morreu sem limpar (kill -9, queda da sessão).
                file.delete(null);
                continue;
            }
            list.push(p);
        } catch {
            // Arquivo pela metade ou corrompido: fica para a próxima leitura.
        }
    }
    iter.close(null);
    return list;
}

function openTerminal() {
    const app = Shell.AppSystem.get_default().lookup_app(TERMINAL_APP);
    if (app)
        app.open_new_window(-1);
    else
        GLib.spawn_command_line_async('x-terminal-emulator');
}

// Botão >_ : abre um terminal novo, sempre.
export class TerminalNewItem extends PanelItem {
    constructor(tooltip) {
        super();
        const btn = iconButton('utilities-terminal-symbolic', openTerminal);
        tooltip.attach(btn, () => 'Novo terminal');
        this.actor.add_child(btn);
    }
}

// Uma bolinha por janela do terminal, na cor da pasta.
export class TerminalDotsItem extends PanelItem {
    constructor(tooltip) {
        super();
        this._tooltip = tooltip;
        this._order = new Map();     // MetaWindow -> número de chegada
        this._winSignals = new Map(); // MetaWindow -> [ids]
        this._seq = 0;
        this._presence = [];

        this._dots = new St.BoxLayout({style_class: 'zf-dots', y_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this._dots);

        GLib.mkdir_with_parents(PRESENCE_DIR, 0o700);
        this._monitor = Gio.File.new_for_path(PRESENCE_DIR).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => this._queuePresenceReload());
        this._presence = readPresence();

        this._displaySignals = [
            global.display.connect('window-created', (_d, win) => {
                // O WM_CLASS pode chegar um instante depois da criação.
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._track(win);
                    return GLib.SOURCE_REMOVE;
                });
            }),
            global.display.connect('notify::focus-window', () => this._render()),
        ];
        for (const actor of global.get_window_actors())
            this._track(actor.meta_window, false);
        this._render();
    }

    _track(win, render = true) {
        if (!win || this._order.has(win) || !isTerminal(win))
            return;
        this._order.set(win, this._seq++);
        this._winSignals.set(win, [
            win.connect('notify::title', () => this._render()),
            win.connect('unmanaged', () => this._untrack(win)),
        ]);
        if (render)
            this._render();
    }

    _untrack(win) {
        for (const id of this._winSignals.get(win) ?? [])
            win.disconnect(id);
        this._winSignals.delete(win);
        this._order.delete(win);
        this._render();
    }

    _queuePresenceReload() {
        if (this._reloadId)
            return;
        this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            this._reloadId = 0;
            this._presence = readPresence();
            this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _presenceFor(win) {
        const title = win.get_title() ?? '';
        return this._presence.find(p => p.title === title) ?? null;
    }

    _render() {
        this._dots.destroy_all_children();
        const wins = [...this._order.keys()].sort((a, b) => this._order.get(a) - this._order.get(b));
        const focus = global.display.focus_window;

        for (const win of wins.slice(0, MAX_DOTS)) {
            const p = this._presenceFor(win);
            const dot = new St.Widget({style_class: 'zf-dot', y_align: Clutter.ActorAlign.CENTER});
            if (p?.accent)
                dot.set_style(`background-color: ${p.accent};`);
            else
                dot.add_style_class_name('zf-dot-neutral');
            if (win === focus)
                dot.add_style_class_name('zf-dot-focused');

            const btn = new St.Button({style_class: 'zf-dot-button', y_align: Clutter.ActorAlign.CENTER, child: dot});
            btn.connect('clicked', () => Main.activateWindow(win));
            btn.connect('notify::hover', () => {
                if (btn.hover)
                    dot.add_style_class_name('zf-dot-hover');
                else
                    dot.remove_style_class_name('zf-dot-hover');
            });
            this._tooltip.attach(btn, () => {
                const q = this._presenceFor(win);
                return q?.name || (q?.cwd ? GLib.path_get_basename(q.cwd) : null) || win.get_title();
            });
            this._dots.add_child(btn);
        }

        const extra = wins.length - MAX_DOTS;
        if (extra > 0)
            this._dots.add_child(new St.Label({text: `+${extra}`, style_class: 'zf-dots-more', y_align: Clutter.ActorAlign.CENTER}));
    }

    _onDestroy() {
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._monitor?.cancel();
        this._monitor = null;
        for (const id of this._displaySignals)
            global.display.disconnect(id);
        for (const [win, ids] of this._winSignals) {
            for (const id of ids)
                win.disconnect(id);
        }
        this._winSignals.clear();
        this._order.clear();
    }
}
