// Peças do painel. Cada item (o botão de novo terminal, as bolinhas, Imagens,
// o tiling…) é independente; o painel junta itens em grupos (um botão do
// painel por grupo), na ordem e no lado que o usuário escolheu (layout.js).
//
// Um item com menu carrega o próprio PopupMenu, preso ao seu botão, para
// funcionar dentro de qualquer grupo. O BoxPointer vira a seta sozinho quando
// não há espaço, então o menu abre para cima no painel de baixo do Zorin.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export class PanelItem {
    constructor() {
        this.actor = new St.BoxLayout({style_class: 'zf-item', y_align: Clutter.ActorAlign.CENTER});
        this.actor.connect('destroy', () => {
            this._onDestroy?.();
            this.menu?.destroy();
            this.menu = null;
        });
    }
}

export function iconButton(iconName, onClick) {
    const btn = new St.Button({
        style_class: 'zf-icon-button',
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
        child: new St.Icon({icon_name: iconName, style_class: 'system-status-icon'}),
    });
    if (onClick)
        btn.connect('clicked', onClick);
    return btn;
}

// Item de um botão só, que abre um menu.
export class MenuPanelItem extends PanelItem {
    constructor(accessibleName) {
        super();
        this.button = new St.Button({
            style_class: 'zf-icon-button',
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            accessible_name: accessibleName,
        });
        this.actor.add_child(this.button);

        this.menu = new PopupMenu.PopupMenu(this.button, 0.5, St.Side.TOP);
        this.menu.actor.add_style_class_name('panel-menu');
        this.menu.actor.hide();
        Main.uiGroup.add_child(this.menu.actor);
        Main.panel.menuManager.addMenu(this.menu);

        this.button.connect('clicked', () => this.menu.toggle());
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this.button.add_style_pseudo_class('active');
            else
                this.button.remove_style_pseudo_class('active');
        });
    }
}

// Um grupo = um botão do painel com seus itens lado a lado.
export const PanelGroup = GObject.registerClass(
class PanelGroup extends PanelMenu.Button {
    _init(name, items) {
        super._init(0.0, name, true);
        this.add_style_class_name('zf-group-button');
        this._box = new St.BoxLayout({style_class: 'zf-group', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._box);
        for (const item of items)
            this._box.add_child(item.actor);
    }
});
