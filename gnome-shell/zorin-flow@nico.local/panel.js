// Monta o painel conforme o layout (layout.js):
//   - cria os grupos de itens do Zorin Flow, um botão do painel por grupo;
//   - põe cada grupo e cada item de outra extensão (o HD, a bandeja…) na
//     caixa e na ordem escolhidas, e esconde os marcados como escondidos;
//   - publica em `panel-foreign` os itens de outras extensões que estão no
//     painel, para o editor (que roda em outro processo) poder mostrá-los.
// A ordem dos elementos do sistema e das caixas é do próprio painel do Zorin;
// o editor escreve lá direto.
//
// Outras extensões podem pôr ou tirar itens a qualquer hora: as caixas são
// observadas e o arranjo é refeito. Ao desligar, os itens de fora voltam para
// onde estavam e reaparecem.

import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {PanelGroup} from './item.js';
import {BOX_ELEMENTS, BOX_PANEL_NAME, isExternal, readBoxes, readHidden} from './layout.js';

const OWN_PREFIX = 'zorin-flow-';

// Nomes melhores para itens conhecidos de outras extensões.
const FOREIGN_TITLES = {
    'drive-menu': 'Dispositivos removíveis (HD, pendrive)',
    'keyboard': 'Idioma do teclado',
    'a11y': 'Acessibilidade',
    'printers': 'Impressoras',
};

function panelBox(box) {
    return Main.panel[`_${BOX_PANEL_NAME[box]}Box`];
}

function findIcon(actor) {
    if (actor instanceof St.Icon)
        return actor;
    for (const child of actor.get_children?.() ?? []) {
        const icon = findIcon(child);
        if (icon)
            return icon;
    }
    return null;
}

export class PanelLayout {
    constructor(settings, factories) {
        this._settings = settings;
        this._factories = factories;
        this._groups = new Map();   // "caixa:índice" -> PanelGroup
        this._ownSig = null;
        this._moved = new Map();    // container de fora -> {parent, index}
        this._hiddenByUs = new Set();
        this._arranging = false;

        this._boxSignals = BOX_ELEMENTS.map(box => {
            const actor = panelBox(box);
            return [actor, [
                actor.connect('child-added', () => this._queue()),
                actor.connect('child-removed', () => this._queue()),
            ]];
        });
        this._settingsIds = ['panel-layout', 'panel-hidden'].map(key =>
            settings.connect(`changed::${key}`, () => this.sync()));
        this.sync();
    }

    _queue() {
        if (this._arranging || this._queueId)
            return;
        this._queueId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._queueId = 0;
            this.sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    sync() {
        const boxes = readBoxes(this._settings);
        const hidden = readHidden(this._settings);
        this._buildOwn(boxes, hidden);
        this._arrange(boxes, hidden);
        this._publishForeign();
    }

    // Grupos do Zorin Flow: só recria quando a composição muda.
    _buildOwn(boxes, hidden) {
        const wanted = BOX_ELEMENTS.map(box => [box, boxes[box]
            .filter(g => !isExternal(g[0]))
            .map(g => g.filter(id => this._factories.has(id) && !hidden.has(id)))
            .filter(g => g.length)]);
        const sig = JSON.stringify(wanted);
        if (sig === this._ownSig)
            return;
        this._ownSig = sig;

        this._arranging = true;
        for (const group of this._groups.values())
            group.destroy();
        this._groups.clear();
        for (const [box, groups] of wanted) {
            groups.forEach((ids, gi) => {
                const group = new PanelGroup(`Zorin Flow: ${ids.join(', ')}`,
                    ids.map(id => this._factories.get(id)()));
                Main.panel.addToStatusArea(`${OWN_PREFIX}${box}-${gi}`, group, gi, BOX_PANEL_NAME[box]);
                this._groups.set(`${box}:${gi}`, group);
            });
        }
        this._arranging = false;
    }

    // Ordem final de cada caixa: nossos grupos e os itens de fora, como no layout.
    _arrange(boxes, hidden) {
        this._arranging = true;
        try {
            for (const box of BOX_ELEMENTS) {
                const actor = panelBox(box);
                const sequence = [];
                let own = 0;
                for (const g of boxes[box]) {
                    if (isExternal(g[0])) {
                        const role = g[0].slice(4);
                        const indicator = Main.panel.statusArea[role];
                        if (!indicator?.container)
                            continue;
                        this._setForeignHidden(indicator.container, hidden.has(g[0]));
                        sequence.push(indicator.container);
                    } else if (g.some(id => this._factories.has(id) && !hidden.has(id))) {
                        const group = this._groups.get(`${box}:${own++}`);
                        if (group)
                            sequence.push(group.container);
                    }
                }
                sequence.forEach((container, index) => {
                    const parent = container.get_parent();
                    if (parent !== actor) {
                        if (!this._moved.has(container) && parent) {
                            this._moved.set(container,
                                {parent, index: parent.get_children().indexOf(container)});
                            container.connect('destroy', () => {
                                this._moved.delete(container);
                                this._hiddenByUs.delete(container);
                            });
                        }
                        parent?.remove_child(container);
                        actor.insert_child_at_index(container, index);
                    } else {
                        actor.set_child_at_index(container, index);
                    }
                });
            }
        } finally {
            this._arranging = false;
        }
    }

    _setForeignHidden(container, hide) {
        if (hide) {
            if (container.visible) {
                container.hide();
                this._hiddenByUs.add(container);
            }
        } else if (this._hiddenByUs.has(container)) {
            container.show();
            this._hiddenByUs.delete(container);
        }
    }

    _publishForeign() {
        const list = [];
        for (const [role, indicator] of Object.entries(Main.panel.statusArea)) {
            if (role.startsWith(OWN_PREFIX) || !indicator?.container)
                continue;
            const parent = indicator.container.get_parent();
            const box = BOX_ELEMENTS.find(b => panelBox(b) === parent);
            if (!box)
                continue; // elementos do sistema ficam fora das caixas
            const icon = findIcon(indicator);
            let iconName = icon?.gicon?.to_string?.() ?? icon?.icon_name ?? null;
            if (iconName && /^\. GThemedIcon /.test(iconName))
                iconName = iconName.split(' ')[2] ?? null;
            const title = FOREIGN_TITLES[role] ?? indicator.accessible_name ?? role;
            list.push({role, title: String(title || role), icon: iconName, box});
        }
        list.sort((a, b) => a.role.localeCompare(b.role));
        const json = JSON.stringify(list);
        if (json !== this._settings.get_string('panel-foreign'))
            this._settings.set_string('panel-foreign', json);
    }

    destroy() {
        if (this._queueId)
            GLib.source_remove(this._queueId);
        for (const [actor, ids] of this._boxSignals)
            ids.forEach(id => actor.disconnect(id));
        for (const id of this._settingsIds)
            this._settings.disconnect(id);

        this._arranging = true;
        for (const group of this._groups.values())
            group.destroy();
        this._groups.clear();
        // Itens de fora: de volta para onde estavam, visíveis.
        for (const container of this._hiddenByUs)
            container.show();
        this._hiddenByUs.clear();
        for (const [container, {parent, index}] of this._moved) {
            const current = container.get_parent();
            if (!current || current === parent)
                continue;
            current.remove_child(container);
            parent.insert_child_at_index(container, Math.min(index, parent.get_n_children()));
        }
        this._moved.clear();
        this._settings = null;
    }
}
