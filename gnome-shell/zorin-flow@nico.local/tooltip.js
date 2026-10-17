// Etiqueta flutuante para os botões do painel — acima do botão quando o painel
// está embaixo (o do Zorin), abaixo quando está em cima.

import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class Tooltip {
    constructor() {
        this._label = new St.Label({style_class: 'zf-tooltip', visible: false});
        Main.uiGroup.add_child(this._label);
    }

    show(actor, text) {
        if (!text)
            return;
        this._label.text = text;
        this._label.show();
        Main.uiGroup.set_child_above_sibling(this._label, null);

        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        const [, lw] = this._label.get_preferred_width(-1);
        const [, lh] = this._label.get_preferred_height(lw);
        const monitor = Main.layoutManager.findMonitorForActor(actor) ?? Main.layoutManager.primaryMonitor;

        let lx = Math.round(x + w / 2 - lw / 2);
        lx = Math.max(monitor.x + 4, Math.min(lx, monitor.x + monitor.width - lw - 4));
        const below = y + h / 2 < monitor.y + monitor.height / 2;
        const ly = Math.round(below ? y + h + 6 : y - lh - 6);
        this._label.set_position(lx, ly);
    }

    hide() {
        this._label.hide();
    }

    // Liga hover/foco de `actor` à etiqueta; `textFn` é chamado a cada exibição.
    attach(actor, textFn) {
        actor.track_hover = true;
        actor.connect('notify::hover', () => {
            if (actor.hover)
                this.show(actor, textFn());
            else
                this.hide();
        });
        actor.connect('destroy', () => this.hide());
    }

    destroy() {
        this._label.destroy();
        this._label = null;
    }
}
