// Fechar janelas pelo Alt+Tab, como no POP Flow: um X no canto da miniatura
// selecionada ou sob o mouse, e o clique do meio em qualquer miniatura.
//
// O Alt+Tab do Zorin é o WindowSwitcherPopup do próprio GNOME, que já fecha a
// janela selecionada com W/F4 e já tira o item da lista quando a janela some
// ('unmanaged'). Só acrescentamos o botão: ele fecha a janela exata daquela
// miniatura (MetaWindow.delete), nunca uma parecida. Se o app perguntar algo
// antes de fechar (arquivo não salvo), a janela fica na lista.

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';

function decorate(popup) {
    const list = popup._switcherList;
    if (!list?.icons)
        return;

    const sync = () => {
        list.icons.forEach((icon, i) => {
            const bbox = list._items[i];
            if (icon._zfClose && bbox)
                icon._zfClose.visible = bbox.hover || i === list._highlighted;
        });
    };

    list.icons.forEach((icon, i) => {
        const bbox = list._items[i];
        const close = new St.Button({
            style_class: 'zf-alttab-close',
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 14}),
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            visible: false,
        });
        close.connect('clicked', () => icon.window.delete(global.get_current_time()));
        icon._icon.add_child(close);
        icon._zfClose = close;

        bbox.track_hover = true;
        bbox.connect('notify::hover', sync);
        // Clique do meio: fecha sem trocar para a janela. Sem isto o clique
        // desceria até o popup, que o trata como "clicou fora" e fecha.
        bbox.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== Clutter.BUTTON_MIDDLE)
                return Clutter.EVENT_PROPAGATE;
            icon.window.delete(event.get_time());
            return Clutter.EVENT_STOP;
        });
    });

    const highlight = list.highlight.bind(list);
    list.highlight = (index, justOutline) => {
        highlight(index, justOutline);
        sync();
    };
}

export class AltTabClose {
    constructor() {
        const proto = AltTab.WindowSwitcherPopup.prototype;
        this._origInit = proto._init;
        const origInit = this._origInit;
        proto._init = function (...args) {
            origInit.apply(this, args);
            try {
                decorate(this);
            } catch (e) {
                logError(e, 'zorin-flow: Alt+Tab');
            }
        };
    }

    destroy() {
        AltTab.WindowSwitcherPopup.prototype._init = this._origInit;
    }
}
