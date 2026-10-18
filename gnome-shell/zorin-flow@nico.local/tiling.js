// Tiling automático no painel, como o botão do Pop!_OS.
//
// Não reimplementa tiling: liga/desliga o auto-tiling do Zorin Tiling Shell e
// escolhe o layout dele. Cada janela nova vai para o espaço livre do layout
// mais perto do centro; sem espaço livre, ela abre solta. Super+Y alterna.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {MenuPanelItem} from './item.js';

const TILING_SCHEMA = 'org.gnome.shell.extensions.zorin-tiling-shell';
const THUMB_W = 46;
const THUMB_H = 28;

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

export class TilingItem extends MenuPanelItem {
    constructor(settings) {
        super('Tiling automático');
        this._settings = settings;
        this._tiling = new Gio.Settings({schema_id: TILING_SCHEMA});

        this._icon = new St.Icon({icon_name: 'view-grid-symbolic', style_class: 'system-status-icon'});
        this.button.set_child(this._icon);

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

        this._sync();
    }

    _layouts() {
        try {
            return JSON.parse(this._tiling.get_string('layouts-json'));
        } catch {
            return [];
        }
    }

    // Miniatura do layout: cada espaço vira um retângulo arredondado.
    _thumbnail(tiles, active) {
        const area = new St.DrawingArea({
            width: THUMB_W,
            height: THUMB_H,
            style_class: 'zf-tiling-thumb',
            y_align: Clutter.ActorAlign.CENTER,
        });
        area.connect('repaint', a => {
            const cr = a.get_context();
            const [w, h] = a.get_surface_size();
            const gap = 2;
            const radius = 2.5;
            for (const t of tiles) {
                const x = t.x * w + gap / 2;
                const y = t.y * h + gap / 2;
                const tw = t.width * w - gap;
                const th = t.height * h - gap;
                cr.newSubPath();
                cr.arc(x + tw - radius, y + radius, radius, -Math.PI / 2, 0);
                cr.arc(x + tw - radius, y + th - radius, radius, 0, Math.PI / 2);
                cr.arc(x + radius, y + th - radius, radius, Math.PI / 2, Math.PI);
                cr.arc(x + radius, y + radius, radius, Math.PI, 1.5 * Math.PI);
                cr.closePath();
            }
            if (active)
                cr.setSourceRGBA(0.384, 0.627, 0.918, 0.95); // #62a0ea
            else
                cr.setSourceRGBA(1, 1, 1, 0.35);
            cr.fill();
            cr.$dispose();
        });
        return area;
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
        for (const {id, tiles} of this._layouts()) {
            const item = new PopupMenu.PopupMenuItem(LAYOUT_NAMES[id] ?? id);
            item.setOrnament(id === current ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            item.insert_child_below(this._thumbnail(tiles ?? [], id === current), item.label);
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
}
