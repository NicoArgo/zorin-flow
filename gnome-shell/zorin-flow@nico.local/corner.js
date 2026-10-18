// Canto inferior esquerdo → área de trabalho (o "triângulo" do POP Flow).
//
// Uma área pequena na quina de cada tela, por cima do painel: clicar mostra a
// área de trabalho daquela tela; clicar de novo devolve as janelas. Ao passar o
// mouse, um triângulo discreto aparece para mostrar que ali tem ação. O resto
// do botão do menu Zorin, que divide a quina, continua funcionando.

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {toggleDesktop} from './desktop.js';

export class DesktopCorner {
    constructor(settings) {
        this._settings = settings;
        this._actors = [];
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._rebuild());
        this._sizeId = settings.connect('changed::desktop-corner-size', () => this._rebuild());
        this._rebuild();
    }

    _rebuild() {
        this._clear();
        const size = this._settings.get_int('desktop-corner-size');
        Main.layoutManager.monitors.forEach((monitor, index) => {
            const corner = new St.DrawingArea({
                reactive: true,
                track_hover: true,
                x: monitor.x,
                y: monitor.y + monitor.height - size,
                width: size,
                height: size,
            });
            corner.connect('repaint', area => {
                if (!area.hover)
                    return;
                const cr = area.get_context();
                const [w, h] = area.get_surface_size();
                cr.setSourceRGBA(1, 1, 1, 0.55);
                cr.moveTo(0, 0);
                cr.lineTo(0, h);
                cr.lineTo(w, h);
                cr.closePath();
                cr.fill();
                cr.$dispose();
            });
            corner.connect('notify::hover', () => corner.queue_repaint());
            corner.connect('button-press-event', () => Clutter.EVENT_STOP);
            corner.connect('button-release-event', (_a, event) => {
                if (event.get_button() === Clutter.BUTTON_PRIMARY)
                    toggleDesktop(index);
                return Clutter.EVENT_STOP;
            });
            Main.layoutManager.addTopChrome(corner, {affectsInputRegion: true, trackFullscreen: true});
            this._actors.push(corner);
        });
    }

    _clear() {
        for (const actor of this._actors) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._actors = [];
    }

    destroy() {
        Main.layoutManager.disconnect(this._monitorsId);
        this._settings.disconnect(this._sizeId);
        this._clear();
        this._settings = null;
    }
}
