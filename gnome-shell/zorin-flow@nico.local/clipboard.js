// Histórico da área de transferência — Super+V.
//
// Guarda os últimos textos copiados (só na memória: nada vai para o disco, e
// some ao sair da sessão). Super+V abre a lista com um filtro; Enter ou clique
// devolve o item à área de transferência e, se ligado, já cola na janela em
// foco (Ctrl+Shift+V nos terminais). Textos marcados por gerenciadores de
// senha (x-kde-passwordManagerHint) são ignorados.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const MAX_TEXT = 100000;
const SECRET_MIME = 'x-kde-passwordManagerHint';

function preview(text) {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > 70 ? `${line.slice(0, 69)}…` : line;
}

export const ClipboardButton = GObject.registerClass(
class ClipboardButton extends PanelMenu.Button {
    _init(settings) {
        super._init(0.5, 'Zorin Flow: área de transferência');
        this._settings = settings;
        this._history = [];
        this._clipboard = St.Clipboard.get_default();

        this.add_child(new St.Icon({icon_name: 'edit-paste-symbolic', style_class: 'system-status-icon'}));
        this.menu.actor.add_style_class_name('zf-clip-menu');

        this._entry = new St.Entry({
            style_class: 'zf-clip-entry',
            hint_text: 'Filtrar…',
            can_focus: true,
            x_expand: true,
        });
        const entryItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        entryItem.add_child(this._entry);
        this.menu.addMenuItem(entryItem);

        this._list = new PopupMenu.PopupMenuSection();
        const scroll = new St.ScrollView({
            style_class: 'zf-clip-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
        });
        scroll.set_child(this._list.actor);
        const scrollSection = new PopupMenu.PopupMenuSection();
        scrollSection.actor.add_child(scroll);
        this.menu.addMenuItem(scrollSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const clear = new PopupMenu.PopupMenuItem('Limpar histórico');
        clear.connect('activate', () => {
            this._history = [];
        });
        this.menu.addMenuItem(clear);

        this._entry.clutter_text.connect('text-changed', () => this._rebuild());
        this._entry.clutter_text.connect('activate', () => {
            const first = this._list._getMenuItems()[0];
            if (first?._zfText !== undefined)
                this._choose(first._zfText);
        });
        this._entry.clutter_text.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Down) {
                const first = this._list._getMenuItems()[0];
                if (first?.reactive) {
                    first.grab_key_focus();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.menu.connect('open-state-changed', (_m, open) => {
            if (!open)
                return;
            this._entry.text = '';
            this._rebuild();
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                global.stage.set_key_focus(this._entry);
                return GLib.SOURCE_REMOVE;
            });
        });

        this._selection = global.display.get_selection();
        this._ownerId = this._selection.connect('owner-changed', (_s, type, source) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._onClipboardChanged(source);
        });

        Main.wm.addKeybinding('clipboard-shortcut', settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this.menu.toggle());

        this.connect('destroy', () => this._onDestroy());
    }

    _onClipboardChanged(source) {
        if (!source)
            return;
        if (source.get_mimetypes().includes(SECRET_MIME))
            return;
        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_c, text) => {
            if (!text || !text.trim() || text.length > MAX_TEXT)
                return;
            this._history = [text, ...this._history.filter(t => t !== text)]
                .slice(0, this._settings.get_int('clipboard-size'));
            if (this.menu.isOpen)
                this._rebuild();
        });
    }

    _rebuild() {
        this._list.removeAll();
        const needle = this._entry.text.toLowerCase();
        const items = this._history.filter(t => !needle || t.toLowerCase().includes(needle));

        if (!items.length) {
            const empty = new PopupMenu.PopupMenuItem(
                this._history.length ? 'Nada combina com o filtro' : 'Nada copiado ainda',
                {reactive: false});
            this._list.addMenuItem(empty);
            return;
        }
        for (const text of items) {
            const item = new PopupMenu.PopupMenuItem(preview(text));
            item._zfText = text;
            item.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            item.connect('activate', () => this._choose(text));
            this._list.addMenuItem(item);
        }
    }

    _choose(text) {
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        this.menu.close();
        if (!this._settings.get_boolean('clipboard-paste-on-select'))
            return;
        // Espera o menu soltar o teclado e o foco voltar para a janela.
        this._pasteId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 180, () => {
            this._pasteId = 0;
            this._paste();
            return GLib.SOURCE_REMOVE;
        });
    }

    _paste() {
        const win = global.display.focus_window;
        if (!win)
            return;
        const cls = `${win.get_wm_class() ?? ''} ${win.get_wm_class_instance() ?? ''}`.toLowerCase();
        const terminal = /terminal|tilix|kitty|alacritty|konsole|xterm/.test(cls);

        if (!this._vkbd) {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._vkbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        }
        const keys = [Clutter.KEY_Control_L, ...(terminal ? [Clutter.KEY_Shift_L] : []), Clutter.KEY_v];
        const t = GLib.get_monotonic_time();
        for (const k of keys)
            this._vkbd.notify_keyval(t, k, Clutter.KeyState.PRESSED);
        for (const k of keys.reverse())
            this._vkbd.notify_keyval(t, k, Clutter.KeyState.RELEASED);
    }

    _onDestroy() {
        Main.wm.removeKeybinding('clipboard-shortcut');
        this._selection.disconnect(this._ownerId);
        if (this._pasteId)
            GLib.source_remove(this._pasteId);
        this._vkbd?.run_dispose();
        this._vkbd = null;
        this._history = [];
    }
});
