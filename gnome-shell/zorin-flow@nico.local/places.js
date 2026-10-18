// Imagens, Downloads e Mostrar área de trabalho — três itens independentes.
//
// "Mostrar área de trabalho" usa o desktop.js, o mesmo dos cantos da tela: o
// segundo acionamento devolve as janelas, venha ele daqui ou de um canto.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {hasHidden, toggleDesktop} from './desktop.js';
import {PanelItem, iconButton} from './item.js';

function openDir(dir) {
    if (!dir)
        return;
    try {
        Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(dir, null),
            global.create_app_launch_context(0, -1));
    } catch (e) {
        Main.notifyError('Zorin Flow', `Não foi possível abrir ${dir}: ${e.message}`);
    }
}

class SimpleItem extends PanelItem {
    constructor(tooltip, icon, label, action) {
        super();
        const btn = iconButton(icon, action);
        tooltip.attach(btn, typeof label === 'function' ? label : () => label);
        this.actor.add_child(btn);
    }
}

export class PicturesItem extends SimpleItem {
    constructor(tooltip) {
        super(tooltip, 'folder-pictures-symbolic', 'Imagens',
            () => openDir(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES)));
    }
}

export class DownloadsItem extends SimpleItem {
    constructor(tooltip) {
        super(tooltip, 'folder-download-symbolic', 'Downloads',
            () => openDir(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD)));
    }
}

export class DesktopItem extends SimpleItem {
    constructor(tooltip) {
        super(tooltip, 'user-desktop-symbolic',
            () => hasHidden() ? 'Restaurar janelas' : 'Mostrar área de trabalho',
            () => toggleDesktop());
    }
}

// Engrenagem: abre as configurações do Zorin Flow.
export class SettingsItem extends SimpleItem {
    constructor(tooltip, openPreferences) {
        super(tooltip, 'emblem-system-symbolic', 'Configurações do Zorin Flow', () => openPreferences());
    }
}
