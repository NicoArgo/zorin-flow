// Zorin Flow — as ideias do POP Flow (NicoArgo/POP-Flow-Suite) no Zorin OS.
//
// Cada peça liga/desliga sozinha pelas configurações da extensão. Os itens do
// painel são independentes e agrupáveis (item.js, layout.js):
//   terminals.js  novo terminal + bolinhas na cor da pasta
//   borders.js    contorno na cor da pasta + botão Regra da pasta no terminal
//   alttab.js     X para fechar janelas no Alt+Tab
//   corner.js     cantos inferiores → área de trabalho (clique / encostar)
//   places.js     Imagens / Downloads / Mostrar área de trabalho / engrenagem
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
import {ClipboardItem, clearHistory} from './clipboard.js';
import {PanelGroup} from './item.js';
import {BOXES, readHidden, readLayout} from './layout.js';
import {DesktopItem, DownloadsItem, PicturesItem, SettingsItem} from './places.js';
import {TerminalDotsItem, TerminalNewItem} from './terminals.js';
import {TilingItem, tilingAvailable} from './tiling.js';
import {Tooltip} from './tooltip.js';
import {VampireItem} from './vampire.js';
import {WallSync} from './wallsync.js';

export default class ZorinFlowExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._tooltip = new Tooltip();
        this._items = new Map();

        // item -> fábrica. Lado, grupo, ordem e visibilidade vêm das
        // configurações (layout.js).
        const t = this._tooltip;
        this._factories = new Map([
            ['terminal-new', () => new TerminalNewItem(t)],
            ['terminal-dots', () => new TerminalDotsItem(t)],
            ['pictures', () => new PicturesItem(t)],
            ['downloads', () => new DownloadsItem(t)],
            ['desktop', () => new DesktopItem(t)],
            ['settings', () => new SettingsItem(t, () => this.openPreferences())],
            ['clipboard', () => new ClipboardItem(this._settings)],
            ['vampire', () => new VampireItem(this._settings)],
        ]);
        if (tilingAvailable())
            this._factories.set('tiling', () => new TilingItem(this._settings));
        this._layoutSig = null;

        const keys = [
            'panel-layout', 'panel-hidden',
            'terminal-borders', 'terminal-rule-button', 'alttab-close', 'desktop-corner', 'desktop-corner-right',
        ];
        this._settingsIds = keys.map(key =>
            this._settings.connect(`changed::${key}`, () => this._sync()));
        this._sync();

        this._wallsync = new WallSync(this._settings);
    }

    _syncPanel() {
        const layout = readLayout(this._settings);
        const hidden = readHidden(this._settings);
        const wanted = BOXES.map(box => [box, layout[box]
            .map(group => group.filter(id => this._factories.has(id) && !hidden.has(id)))
            .filter(group => group.length)]);
        const sig = JSON.stringify(wanted);
        if (sig === this._layoutSig)
            return;
        this._layoutSig = sig;

        // Remonta tudo: o addToStatusArea é o caminho que o painel do Zorin
        // acompanha, e assim a ordem sai sempre exata.
        for (const group of this._items.values())
            group.destroy();
        this._items.clear();
        for (const [box, groups] of wanted) {
            groups.forEach((ids, index) => {
                const role = `zorin-flow-${box}-${index}`;
                const group = new PanelGroup(`Zorin Flow: ${ids.join(', ')}`,
                    ids.map(id => this._factories.get(id)()));
                Main.panel.addToStatusArea(role, group, index, box);
                this._items.set(role, group);
            });
        }
    }

    _sync() {
        this._syncPanel();

        // Contorno e botão de regra moram no mesmo módulo (borders.js).
        const borders = this._settings.get_boolean('terminal-borders') ||
            this._settings.get_boolean('terminal-rule-button');
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
        this._factories = null;
    }
}
