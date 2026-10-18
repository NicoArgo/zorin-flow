// Botões Imagens, Downloads e Mostrar área de trabalho.
//
// "Mostrar área de trabalho" usa o desktop.js, o mesmo do canto inferior
// esquerdo: o segundo clique devolve as janelas, venha ele daqui ou do canto.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {hasHidden, toggleDesktop} from './desktop.js';

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

export const PlacesButton = GObject.registerClass(
class PlacesButton extends PanelMenu.Button {
    _init(tooltip) {
        super._init(0.0, 'Zorin Flow: atalhos', true);
        this.add_style_class_name('zf-places-button');

        const box = new St.BoxLayout({style_class: 'zf-places', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(box);

        const add = (icon, label, action) => {
            const btn = new St.Button({
                style_class: 'zf-icon-button',
                y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({icon_name: icon, style_class: 'system-status-icon'}),
            });
            btn.connect('clicked', action);
            tooltip.attach(btn, typeof label === 'function' ? label : () => label);
            box.add_child(btn);
        };

        add('folder-pictures-symbolic', 'Imagens',
            () => openDir(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES)));
        add('folder-download-symbolic', 'Downloads',
            () => openDir(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD)));
        add('user-desktop-symbolic',
            () => hasHidden() ? 'Restaurar janelas' : 'Mostrar área de trabalho',
            () => toggleDesktop());
    }
});
