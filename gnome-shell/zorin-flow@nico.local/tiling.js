// Tiling automático no painel, como o botão do Pop!_OS.
//
// Não reimplementa tiling: liga/desliga o auto-tiling do Zorin Tiling Shell e
// escolhe o layout dele. Cada janela nova vai para o espaço livre do layout
// mais perto do centro; sem espaço livre, ela abre solta. Super+Y alterna.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const TILING_SCHEMA = 'org.gnome.shell.extensions.zorin-tiling-shell';

// Nome legível dos layouts que vêm com o Zorin; outros aparecem pelo id.
const LAYOUT_NAMES = {
    'Layout 1': 'Duas colunas',
    'Layout 2': 'Quatro quadrantes',
    'Layout 3': 'Principal largo + lateral',
    'Layout 4': 'Três colunas',
    'Layout 5': 'Principal + duas empilhadas (estilo Pop)',
    'Layout 6': 'Central + quatro cantos',
};

export function tilingAvailable() {
    return Gio.SettingsSchemaSource.get_default().lookup(TILING_SCHEMA, true) !== null;
}

export const TilingButton = GObject.registerClass(
class TilingButton extends PanelMenu.Button {
    _init(settings) {
        super._init(0.5, 'Zorin Flow: tiling');
        this._settings = settings;
        this._tiling = new Gio.Settings({schema_id: TILING_SCHEMA});

        this._icon = new St.Icon({icon_name: 'view-grid-symbolic', style_class: 'system-status-icon'});
        this.add_child(this._icon);

        this._switch = new PopupMenu.PopupSwitchMenuItem('Tiling automático', false);
        this._switch.connect('toggled', (_i, state) => this._tiling.set_boolean('enable-autotiling', state));
        this.menu.addMenuItem(this._switch);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Layout'));
        this._layoutSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._layoutSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const hint = new PopupMenu.PopupMenuItem(
            'Super+Y liga/desliga · Super+setas foco · Super+Shift+setas move', {reactive: false});
        hint.label.add_style_class_name('zf-tiling-hint');
        this.menu.addMenuItem(hint);

        this._tilingIds = ['enable-autotiling', 'selected-layouts', 'layouts-json'].map(key =>
            this._tiling.connect(`changed::${key}`, () => this._sync()));

        Main.wm.addKeybinding('tiling-shortcut', settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL, () => this._toggle());

        this.connect('destroy', () => this._onDestroy());
        this._sync();
    }

    _layouts() {
        try {
            return JSON.parse(this._tiling.get_string('layouts-json')).map(l => l.id);
        } catch {
            return [];
        }
    }

    _currentLayout() {
        const selected = this._tiling.get_value('selected-layouts').deepUnpack();
        return selected[global.workspace_manager.get_active_workspace_index()]?.[0] ?? selected[0]?.[0];
    }

    _setLayout(id) {
        // Mesmo layout em todas as áreas de trabalho e telas.
        const workspaces = Math.max(global.workspace_manager.n_workspaces,
            this._tiling.get_value('selected-layouts').deepUnpack().length);
        const monitors = Main.layoutManager.monitors.length;
        const value = Array.from({length: workspaces}, () => Array.from({length: monitors}, () => id));
        this._tiling.set_value('selected-layouts', new GLib.Variant('aas', value));
    }

    _toggle() {
        const on = !this._tiling.get_boolean('enable-autotiling');
        this._tiling.set_boolean('enable-autotiling', on);
        Main.osdWindowManager.show(-1, Gio.ThemedIcon.new('view-grid-symbolic'),
            on ? 'Tiling automático ligado' : 'Tiling automático desligado');
    }

    _sync() {
        const on = this._tiling.get_boolean('enable-autotiling');
        this._switch.setToggleState(on);
        if (on)
            this._icon.add_style_class_name('zf-tiling-on');
        else
            this._icon.remove_style_class_name('zf-tiling-on');

        this._layoutSection.removeAll();
        const current = this._currentLayout();
        for (const id of this._layouts()) {
            const item = new PopupMenu.PopupMenuItem(LAYOUT_NAMES[id] ?? id);
            item.setOrnament(id === current ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            item.connect('activate', () => this._setLayout(id));
            this._layoutSection.addMenuItem(item);
        }
    }

    _onDestroy() {
        Main.wm.removeKeybinding('tiling-shortcut');
        for (const id of this._tilingIds)
            this._tiling.disconnect(id);
        this._tiling = null;
    }
});
