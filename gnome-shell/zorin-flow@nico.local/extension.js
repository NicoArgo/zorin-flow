// Zorin Flow — as ideias do POP Flow (NicoArgo/POP-Flow-Suite) no Zorin OS.
//
// Cada peça liga/desliga sozinha pelas configurações da extensão:
//   terminals.js  applet de terminais na cor da pasta
//   borders.js    contorno na cor da pasta em volta das janelas do terminal
//   alttab.js     X para fechar janelas no Alt+Tab
//   corner.js     cantos inferiores → área de trabalho (clique / encostar)
//   places.js     Imagens / Downloads / Mostrar área de trabalho
//   vampire.js    modo vampiro
//   clipboard.js  histórico da área de transferência (Super+V)
//   wallsync.js   cor de destaque segue o papel de parede

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AltTabClose} from './alttab.js';
import {TerminalBorders} from './borders.js';
import {DesktopCorners} from './corner.js';
import {forgetHidden} from './desktop.js';
import {ClipboardButton} from './clipboard.js';
import {PlacesButton} from './places.js';
import {TerminalsButton} from './terminals.js';
import {Tooltip} from './tooltip.js';
import {VampireButton} from './vampire.js';
import {WallSync} from './wallsync.js';

export default class ZorinFlowExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._tooltip = new Tooltip();
        this._items = new Map();

        // [chave, papel no painel, posição, caixa, fábrica]
        this._parts = [
            ['show-terminals', 'terminals', 0, 'left', () => new TerminalsButton(this._tooltip)],
            ['show-places', 'places', 1, 'left', () => new PlacesButton(this._tooltip)],
            ['clipboard-enabled', 'clipboard', 0, 'right', () => new ClipboardButton(this._settings)],
            ['show-vampire', 'vampire', 0, 'right', () => new VampireButton(this._settings)],
        ];
        this._settingsIds = [...this._parts.map(([key]) => key), 'terminal-borders', 'alttab-close', 'desktop-corner', 'desktop-corner-right'].map(key =>
            this._settings.connect(`changed::${key}`, () => this._sync()));
        this._sync();

        this._wallsync = new WallSync(this._settings);
    }

    _sync() {
        for (const [key, role, position, box, make] of this._parts) {
            const want = this._settings.get_boolean(key);
            const have = this._items.get(role);
            if (want && !have) {
                const item = make();
                Main.panel.addToStatusArea(`zorin-flow-${role}`, item, position, box);
                this._items.set(role, item);
            } else if (!want && have) {
                have.destroy();
                this._items.delete(role);
            }
        }

        const borders = this._settings.get_boolean('terminal-borders');
        if (borders && !this._borders) {
            this._borders = new TerminalBorders(this._settings);
        } else if (!borders && this._borders) {
            this._borders.destroy();
            this._borders = null;
        }

        const alttab = this._settings.get_boolean('alttab-close');
        if (alttab && !this._alttab) {
            this._alttab = new AltTabClose();
        } else if (!alttab && this._alttab) {
            this._alttab.destroy();
            this._alttab = null;
        }

        const corner = this._settings.get_boolean('desktop-corner') ||
            this._settings.get_boolean('desktop-corner-right');
        if (corner && !this._corner) {
            this._corner = new DesktopCorners(this._settings);
        } else if (!corner && this._corner) {
            this._corner.destroy();
            this._corner = null;
        }
    }

    disable() {
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        for (const item of this._items.values())
            item.destroy();
        this._items.clear();
        this._borders?.destroy();
        this._borders = null;
        this._alttab?.destroy();
        this._alttab = null;
        this._corner?.destroy();
        this._corner = null;
        forgetHidden();
        this._wallsync.destroy();
        this._tooltip.destroy();
        this._wallsync = null;
        this._tooltip = null;
        this._settings = null;
        this._items = null;
        this._parts = null;
    }
}
