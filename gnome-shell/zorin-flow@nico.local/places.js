// Botões Imagens, Downloads e Mostrar área de trabalho.
//
// "Mostrar área de trabalho" minimiza as janelas da área de trabalho atual e,
// no segundo clique, devolve exatamente as que ele minimizou (o Super+D do
// sistema continua funcionando como sempre).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

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
        this._hidden = [];

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
            () => this._hidden.length ? 'Restaurar janelas' : 'Mostrar área de trabalho',
            () => this._toggleDesktop());
    }

    _toggleDesktop() {
        const ws = global.workspace_manager.get_active_workspace();
        const visible = ws.list_windows().filter(w =>
            !w.minimized &&
            w.get_window_type() === Meta.WindowType.NORMAL &&
            !w.is_skip_taskbar() &&
            !w.is_on_all_workspaces());

        if (visible.length) {
            // Mais ao fundo primeiro, para devolver na mesma ordem de empilhamento.
            this._hidden = global.display.sort_windows_by_stacking(visible);
            for (const w of this._hidden)
                w.minimize();
            return;
        }

        const toRestore = this._hidden.filter(w => w.get_workspace?.() === ws && w.minimized);
        this._hidden = [];
        for (const w of toRestore)
            w.unminimize();
        if (toRestore.length)
            Main.activateWindow(toRestore[toRestore.length - 1]);
    }
});
