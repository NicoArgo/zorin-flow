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

import {AltTabClose} from './alttab.js';
import {TerminalBorders} from './borders.js';
import {DesktopCorners} from './corner.js';
import {forgetHidden} from './desktop.js';
import {ClipboardItem, clearHistory} from './clipboard.js';
import {PanelLayout} from './panel.js';
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
        this._panel = new PanelLayout(this._settings, this._factories);

        const keys = [
            'terminal-borders', 'terminal-rule-button', 'alttab-close', 'desktop-corner', 'desktop-corner-right',
        ];
        this._settingsIds = keys.map(key =>
            this._settings.connect(`changed::${key}`, () => this._sync()));
        this._sync();

        this._wallsync = new WallSync(this._settings);
    }

    _sync() {
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
        this._panel.destroy();
        this._panel = null;
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
        this._factories = null;
    }
}
