// Cantos inferiores → área de trabalho (o "triângulo" do POP Flow).
//
// Uma área pequena na quina de cada tela, por cima do painel:
//   - esquerdo: clicar mostra a área de trabalho daquela tela;
//   - direito: basta encostar o mouse (depois de uma pausa curta, para não
//     disparar quando o mouse só passa por ali).
// Acionar de novo devolve as janelas. Ao passar o mouse, um triângulo discreto
// mostra que ali tem ação. No esquerdo, o resto do botão do menu Zorin, que
// divide a quina, continua funcionando.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {toggleDesktop} from './desktop.js';

const HOVER_DELAY_MS = 250;

export class DesktopCorners {
    constructor(settings) {
        this._settings = settings;
        this._actors = [];
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._rebuild());
        this._settingsIds = ['desktop-corner', 'desktop-corner-right', 'desktop-corner-size'].map(key =>
            settings.connect(`changed::${key}`, () => this._rebuild()));
        this._rebuild();
    }

    _rebuild() {
        this._clear();
        const size = this._settings.get_int('desktop-corner-size');
        const sides = [];
        if (this._settings.get_boolean('desktop-corner'))
            sides.push('left');
        if (this._settings.get_boolean('desktop-corner-right'))
            sides.push('right');

        Main.layoutManager.monitors.forEach((monitor, index) => {
            for (const side of sides)
                this._addCorner(monitor, index, side, size);
        });
    }

    _addCorner(monitor, index, side, size) {
        const left = side === 'left';
        const corner = new St.DrawingArea({
            reactive: true,
            track_hover: true,
            x: left ? monitor.x : monitor.x + monitor.width - size,
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
            cr.moveTo(left ? 0 : w, 0);
            cr.lineTo(left ? 0 : w, h);
            cr.lineTo(left ? w : 0, h);
            cr.closePath();
            cr.fill();
            cr.$dispose();
        });

        let hoverId = 0;
        corner.connect('notify::hover', () => {
            corner.queue_repaint();
            if (left)
                return;
            if (hoverId) {
                GLib.source_remove(hoverId);
                hoverId = 0;
            }
            // Um disparo por visita: sair e voltar para acionar de novo.
            if (corner.hover) {
                hoverId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOVER_DELAY_MS, () => {
                    hoverId = 0;
                    toggleDesktop(index);
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        corner.connect('destroy', () => {
            if (hoverId)
                GLib.source_remove(hoverId);
        });

        corner.connect('button-press-event', () => Clutter.EVENT_STOP);
        corner.connect('button-release-event', (_a, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                if (hoverId) {
                    GLib.source_remove(hoverId);
                    hoverId = 0;
                }
                toggleDesktop(index);
            }
            return Clutter.EVENT_STOP;
        });

        Main.layoutManager.addTopChrome(corner, {affectsInputRegion: true, trackFullscreen: true});
        this._actors.push(corner);
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
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._clear();
        this._settings = null;
    }
}
