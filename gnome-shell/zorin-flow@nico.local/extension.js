// Zorin Flow — as ideias do POP Flow (NicoArgo/POP-Flow-Suite) no Zorin OS.
//
// Cada peça liga/desliga sozinha pelas configurações da extensão:
//   terminals.js  applet de terminais na cor da pasta
//   borders.js    contorno na cor da pasta em volta das janelas do terminal
//   alttab.js     X para fechar janelas no Alt+Tab
//   corner.js     cantos inferiores → área de trabalho (clique / encostar)
//   places.js     Imagens / Downloads / Mostrar área de trabalho
//   tiling.js     botão de tiling automático (Zorin Tiling Shell), Super+Y
//   vampire.js    modo vampiro
//   clipboard.js  histórico da área de transferência (Super+V)
//   wallsync.js   cor de destaque segue o papel de parede

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AltTabClose} from './alttab.js';
import {TerminalBorders} from './borders.js';
import {DesktopCorners} from './corner.js';
import {forgetHidden} from './desktop.js';
import {ClipboardButton, clearHistory} from './clipboard.js';
import {BOXES, readLayout} from './layout.js';
import {PlacesButton} from './places.js';
import {SettingsButton} from './settingsButton.js';
import {TerminalsButton} from './terminals.js';
import {TilingButton, tilingAvailable} from './tiling.js';
import {Tooltip} from './tooltip.js';
import {VampireButton} from './vampire.js';
import {WallSync} from './wallsync.js';

export default class ZorinFlowExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._tooltip = new Tooltip();
        this._items = new Map();

        // papel no painel -> [chave que liga/desliga, fábrica]. Lado e ordem
        // vêm das configurações (layout.js).
        this._parts = new Map([
            ['terminals', ['show-terminals', () => new TerminalsButton(this._tooltip)]],
            ['places', ['show-places', () => new PlacesButton(this._tooltip)]],
            ['clipboard', ['clipboard-enabled', () => new ClipboardButton(this._settings)]],
            ['vampire', ['show-vampire', () => new VampireButton(this._settings)]],
            ['settings', ['show-settings', () => new SettingsButton(this._tooltip, () => this.openPreferences())]],
        ]);
        if (tilingAvailable())
            this._parts.set('tiling', ['show-tiling', () => new TilingButton(this._settings)]);
        this._layoutSig = null;

        const keys = [
            ...[...this._parts.values()].map(([key]) => key),
            ...BOXES.map(box => `panel-${box}`),
            'terminal-borders', 'alttab-close', 'desktop-corner', 'desktop-corner-right',
        ];
        this._settingsIds = keys.map(key =>
            this._settings.connect(`changed::${key}`, () => this._sync()));
        this._sync();

        this._wallsync = new WallSync(this._settings);
    }

    _syncPanel() {
        // Applets ligados, por lado, na ordem das configurações.
        const layout = readLayout(this._settings);
        const wanted = BOXES.map(box => [box, layout[box].filter(role =>
            this._parts.has(role) && this._settings.get_boolean(this._parts.get(role)[0]))]);
        const sig = JSON.stringify(wanted);
        if (sig === this._layoutSig)
            return;
        this._layoutSig = sig;

        // Remonta tudo: o addToStatusArea é o caminho que o painel do Zorin
        // acompanha, e assim a ordem sai sempre exata.
        for (const item of this._items.values())
            item.destroy();
        this._items.clear();
        for (const [box, roles] of wanted) {
            roles.forEach((role, index) => {
                const item = this._parts.get(role)[1]();
                Main.panel.addToStatusArea(`zorin-flow-${role}`, item, index, box);
                this._items.set(role, item);
            });
        }
    }

    _sync() {
        this._syncPanel();

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
        clearHistory();
        this._wallsync.destroy();
        this._tooltip.destroy();
        this._wallsync = null;
        this._tooltip = null;
        this._settings = null;
        this._items = null;
        this._parts = null;
    }
}
