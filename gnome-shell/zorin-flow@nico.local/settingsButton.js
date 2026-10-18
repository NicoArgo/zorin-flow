// Engrenagem no painel: abre as configurações do Zorin Flow.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const SettingsButton = GObject.registerClass(
class SettingsButton extends PanelMenu.Button {
    _init(tooltip, openPreferences) {
        super._init(0.0, 'Zorin Flow: configurações', true);
        const btn = new St.Button({
            style_class: 'zf-icon-button',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'emblem-system-symbolic', style_class: 'system-status-icon'}),
        });
        btn.connect('clicked', () => openPreferences());
        tooltip.attach(btn, () => 'Configurações do Zorin Flow');
        this.add_child(btn);
    }
});
