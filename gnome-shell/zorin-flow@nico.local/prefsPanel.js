// Editor visual do painel inteiro: uma barra que imita o painel, com três
// lados (Esquerda, Centro, Direita) e tudo o que há nele — os elementos do
// sistema (menu Zorin, Atividades, apps abertos, menu do sistema, data e
// hora), os itens do Zorin Flow e os de outras extensões (o HD, a bandeja…).
//
// Cada moldura é uma peça do painel. Itens do Zorin Flow dentro da mesma
// moldura ficam colados num mesmo botão (um grupo).
// Arrastar:
//   - um item para dentro de uma moldura de itens → entra naquele grupo
//   - qualquer peça para o espaço entre molduras  → vai para ali
// Clicar numa peça abre: separar/juntar (itens), lado e mostrar/esconder.
// Só o que está ativo aparece na barra; o resto fica em "Escondidos", logo
// abaixo: arraste de lá para o painel (ou clique) para mostrar, e arraste da
// barra para lá para esconder.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import * as L from './layout.js';

const CSS = `
.zf-panel-bar {
    background-color: alpha(@window_fg_color, 0.07);
    border-radius: 12px;
    padding: 8px;
}
.zf-zone {
    border-radius: 9px;
    padding: 4px 6px;
    min-height: 60px;
    border: 2px dashed transparent;
}
.zf-zone-title {
    font-size: 0.85em;
    opacity: 0.6;
}
.zf-zone-hover {
    border-color: alpha(@accent_color, 0.5);
}
.zf-group-frame {
    border-radius: 10px;
    padding: 3px;
    background-color: alpha(@window_fg_color, 0.06);
    border: 2px solid alpha(@window_fg_color, 0.12);
}
.zf-sys-frame {
    background-color: alpha(@window_fg_color, 0.14);
    border-style: dotted;
}
.zf-ext-frame {
    border-style: dashed;
}
.zf-group-target {
    border-color: @accent_color;
    background-color: alpha(@accent_color, 0.12);
}
.zf-chip {
    padding: 4px 4px;
    border-radius: 7px;
    min-width: 42px;
}
.zf-chip:hover {
    background-color: alpha(@window_fg_color, 0.12);
}
.zf-chip-label {
    font-size: 0.75em;
}
.zf-chip-dragging {
    opacity: 0.2;
}
.zf-hidden-area {
    border-radius: 10px;
    padding: 6px;
    min-height: 48px;
    border: 2px dashed alpha(@window_fg_color, 0.15);
}
.zf-hidden-area > flowboxchild {
    padding: 0;
    background: none;
    outline: none;
}
.zf-hidden-hover {
    border-color: @accent_color;
    background-color: alpha(@accent_color, 0.08);
}
.zf-drop-before {
    box-shadow: -9px 0 0 -4px @accent_color;
}
.zf-drop-after {
    box-shadow: 9px 0 0 -4px @accent_color;
}
`;

const GROUP_EDGE = 12; // px nas bordas de uma moldura de itens que contam como "fora"
const FALLBACK_ICON = 'application-x-addon-symbolic';

function stringValue(text) {
    const value = new GObject.Value();
    value.init(GObject.TYPE_STRING);
    value.set_string(text);
    return value;
}

function bounds(widget, relativeTo) {
    const [ok, rect] = widget.compute_bounds(relativeTo);
    return ok ? {x: rect.get_x(), y: rect.get_y(), w: rect.get_width(), h: rect.get_height()} : null;
}

function indexAmong(widgets, relativeTo, x) {
    for (let i = 0; i < widgets.length; i++) {
        const b = bounds(widgets[i], relativeTo);
        if (b && x < b.x + b.w / 2)
            return i;
    }
    return widgets.length;
}

function lookupSchema(id) {
    const schema = Gio.SettingsSchemaSource.get_default().lookup(id, true);
    return schema ? new Gio.Settings({settings_schema: schema}) : null;
}

// Fileira que quebra linha: peças lado a lado, da esquerda para a direita,
// passando para a linha de baixo quando não cabem (sem alinhar em colunas,
// como faria o Gtk.FlowBox).
const WrapLayout = GObject.registerClass(
class WrapLayout extends Gtk.LayoutManager {
    _init(params = {}) {
        super._init();
        this.hSpacing = params.hSpacing ?? 12;
        this.vSpacing = params.vSpacing ?? 8;
    }

    *_children(widget) {
        for (let c = widget.get_first_child(); c; c = c.get_next_sibling()) {
            if (c.should_layout())
                yield c;
        }
    }

    _lines(widget, width) {
        const lines = [];
        let line = {items: [], w: 0, h: 0};
        for (const c of this._children(widget)) {
            const [, w] = c.measure(Gtk.Orientation.HORIZONTAL, -1);
            const [, h] = c.measure(Gtk.Orientation.VERTICAL, w);
            const needed = line.items.length ? line.w + this.hSpacing + w : w;
            if (line.items.length && width >= 0 && needed > width) {
                lines.push(line);
                line = {items: [], w: 0, h: 0};
            }
            line.w = line.items.length ? line.w + this.hSpacing + w : w;
            line.h = Math.max(line.h, h);
            line.items.push([c, w, h]);
        }
        if (line.items.length)
            lines.push(line);
        return lines;
    }

    vfunc_get_request_mode() {
        return Gtk.SizeRequestMode.HEIGHT_FOR_WIDTH;
    }

    vfunc_measure(widget, orientation, forSize) {
        if (orientation === Gtk.Orientation.HORIZONTAL) {
            let min = 0, nat = 0, n = 0;
            for (const c of this._children(widget)) {
                const [cmin, cnat] = c.measure(orientation, -1);
                min = Math.max(min, cmin);
                nat += cnat + (n++ ? this.hSpacing : 0);
            }
            return [min, nat, -1, -1];
        }
        const lines = this._lines(widget, forSize);
        const h = lines.reduce((sum, l, i) => sum + l.h + (i ? this.vSpacing : 0), 0);
        return [h, h, -1, -1];
    }

    vfunc_allocate(widget, width, _height, _baseline) {
        let y = 0;
        for (const line of this._lines(widget, width)) {
            let x = 0;
            for (const [c, w, h] of line.items) {
                const rect = new Gdk.Rectangle({x, y: y + Math.floor((line.h - h) / 2), width: w, height: h});
                c.size_allocate(rect, -1);
                x += w + this.hSpacing;
            }
            y += line.h + this.vSpacing;
        }
    }
});

const WrapBox = GObject.registerClass(
class WrapBox extends Gtk.Widget {
    _init(params = {}) {
        super._init(params);
        this.set_layout_manager(new WrapLayout());
    }

    append(child) {
        child.set_parent(this);
    }

    remove(child) {
        child.unparent();
    }

    vfunc_dispose() {
        let c;
        while ((c = this.get_first_child()))
            c.unparent();
        super.vfunc_dispose();
    }
});

// "item:clipboard" → ['item', 'clipboard']; "item:ext:drive-menu" → ['item', 'ext:drive-menu']
function splitPayload(payload) {
    const i = payload.indexOf(':');
    return [payload.slice(0, i), payload.slice(i + 1)];
}

export function panelEditorGroup(settings) {
    const display = Gdk.Display.get_default();
    const provider = new Gtk.CssProvider();
    provider.load_from_string(CSS);
    Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const iconTheme = Gtk.IconTheme.get_for_display(display);
    const taskbar = lookupSchema(L.ZORIN_TASKBAR_SCHEMA);

    const group = new Adw.PreferencesGroup({
        title: 'Painel',
        description: 'Tudo o que há no painel, cada peça numa moldura. Arraste para mudar o lado e a ordem; ' +
            'arraste um item do Zorin Flow para dentro de outra moldura de itens para agrupar. ' +
            'Clique numa peça para mais opções.',
    });

    // Um lado por linha (Esquerda, Centro, Direita), para tudo caber sem
    // esconder lados fora da tela.
    const bar = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, css_classes: ['zf-panel-bar']});
    group.add(bar);

    const hiddenTitle = new Gtk.Label({
        label: 'Escondidos — arraste para o painel ou clique para mostrar; arraste peças da barra para cá para esconder',
        css_classes: ['caption-heading'],
        xalign: 0,
        wrap: true,
        margin_top: 12,
        margin_bottom: 4,
    });
    group.add(hiddenTitle);
    const hiddenArea = new Gtk.FlowBox({
        selection_mode: Gtk.SelectionMode.NONE,
        column_spacing: 6,
        row_spacing: 6,
        max_children_per_line: 20,
        css_classes: ['zf-hidden-area'],
    });
    group.add(hiddenArea);

    group.add(new Gtk.Label({
        label: 'Moldura pontilhada: sistema · tracejada: outra extensão · lisa: Zorin Flow',
        css_classes: ['dim-label', 'caption'],
        xalign: 0,
        wrap: true,
        margin_top: 6,
    }));

    let state = null;
    let hidden = new Set();
    let foreign = new Map();
    const zones = {};
    let marked = [];
    let hiddenChildren = [];

    const readState = () => {
        const elements = L.readElements(taskbar);
        const foreignList = L.readForeign(settings);
        foreign = new Map(foreignList.map(f => [`ext:${f.role}`, f]));
        hidden = L.readHidden(settings);
        state = {
            zones: elements.zones,
            visible: elements.visible,
            boxes: L.withForeign(L.readBoxes(settings), foreignList),
        };
    };

    const save = next => {
        if (!next)
            return;
        const zonesChanged = JSON.stringify(next.zones) !== JSON.stringify(state.zones) ||
            JSON.stringify(next.visible) !== JSON.stringify(state.visible);
        const boxesChanged = JSON.stringify(next.boxes) !== JSON.stringify(state.boxes);
        if (boxesChanged)
            L.writeBoxes(settings, next.boxes);
        if (zonesChanged)
            L.writeElements(taskbar, next.zones, next.visible);
    };

    const isOff = payload => {
        const [kind, id] = splitPayload(payload);
        return kind === 'el' ? state.visible[id] === false : hidden.has(id);
    };

    const setShown = (payload, shown) => {
        const [kind, id] = splitPayload(payload);
        if (kind === 'el')
            save({...state, visible: {...state.visible, [id]: shown}});
        else
            L.setHidden(settings, id, !shown);
    };

    // --- aparência de cada peça ---

    const describe = payload => {
        const [kind, id] = splitPayload(payload);
        if (kind === 'el') {
            const info = L.SYSTEM_ELEMENTS[id] ?? {title: id, short: id, icon: FALLBACK_ICON};
            return {...info, off: state.visible[id] === false};
        }
        if (L.isExternal(id)) {
            const f = foreign.get(id);
            const title = f?.title ?? id.slice(4);
            const word = title.split(/[\s(]/)[0];
            const short = f?.short ?? (word.length > 11 ? `${word.slice(0, 10)}…` : word);
            return {title, short, icon: f?.icon, off: hidden.has(id)};
        }
        const info = L.ITEMS.find(i => i.id === id);
        return {...info, off: hidden.has(id)};
    };

    const iconFor = name => {
        if (name && (name.startsWith('/') || name.includes('://') || name.startsWith('. ')))
            return {gicon: Gio.Icon.new_for_string(name)};
        return {icon_name: name && iconTheme.has_icon(name) ? name : FALLBACK_ICON};
    };

    // --- destaque do destino (só sombra: não desloca nada) ---

    const mark = (widget, cls) => {
        widget.add_css_class(cls);
        marked.push([widget, cls]);
    };
    const clearFeedback = () => {
        for (const [widget, cls] of marked)
            widget.remove_css_class(cls);
        marked = [];
    };

    // --- onde cai o que está sendo arrastado ---

    // {next, show}: o novo estado (null = não pode) e como destacar o destino.
    const resolve = (payload, zone, x, y) => {
        const [kind, id] = splitPayload(payload);
        const z = zones[zone];
        const nodes = z.nodes;
        const gap = i => {
            const left = nodes[i - 1]?.token ?? null;
            const right = nodes[i]?.token ?? null;
            const next = kind === 'el'
                ? L.dropElement(state, id, zone, left, right)
                : L.dropItem(state, id, zone, left, right);
            return {next, show: () => {
                if (i < nodes.length)
                    mark(nodes[i].frame, 'zf-drop-before');
                else if (nodes.length)
                    mark(nodes[nodes.length - 1].frame, 'zf-drop-after');
            }};
        };
        // Peças em linhas (quebra): a peça i está "depois" do cursor se a linha
        // dela começa abaixo dele, ou se é a mesma linha e ela fica à direita.
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const b = bounds(n.frame, z.row);
            if (!b)
                continue;
            if (y < b.y - 4)
                return gap(i);
            if (y > b.y + b.h + 4)
                continue;
            if (x < b.x)
                return gap(i);
            if (x > b.x + b.w)
                continue;
            const joinable = kind === 'item' && !L.isExternal(id) &&
                n.token.kind === 'group' && !L.isExternal(n.token.ids[0]);
            if (!joinable)
                return gap(x < b.x + b.w / 2 ? i : i + 1);
            const edge = Math.min(GROUP_EDGE, b.w / 4);
            if (x < b.x + edge)
                return gap(i);
            if (x > b.x + b.w - edge)
                return gap(i + 1);
            const [, fx] = z.row.translate_coordinates(n.frame, x, y);
            const index = indexAmong(n.chips, n.frame, fx);
            // O grupo pode ter itens escondidos (sem chip): converte a posição.
            const shownIds = n.chips.map(c => c._zfId);
            const modelIndex = index < shownIds.length ? n.token.ids.indexOf(shownIds[index]) : n.token.ids.length;
            return {
                next: L.joinGroup(state, id, n.token.box, n.token.gi, modelIndex),
                show: () => {
                    mark(n.frame, 'zf-group-target');
                    if (index < n.chips.length)
                        mark(n.chips[index], 'zf-drop-before');
                    else
                        mark(n.chips[n.chips.length - 1], 'zf-drop-after');
                },
            };
        }
        return gap(nodes.length);
    };

    // --- menu de cada peça ---

    const makePopover = payload => {
        const [kind, id] = splitPayload(payload);
        const d = describe(payload);
        const pop = new Gtk.Popover();
        const col = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6,
            margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
        col.append(new Gtk.Label({label: d.title, css_classes: ['heading'], xalign: 0}));

        const button = (label, next) => {
            const b = new Gtk.Button({label, sensitive: !!next});
            b.connect('clicked', () => {
                pop.popdown();
                save(next);
            });
            col.append(b);
        };

        let zone;
        if (kind === 'el') {
            zone = L.zoneOf(state, id);
        } else {
            const loc = L.locateItem(state, id);
            zone = L.zoneOf(state, loc.box);
            if (!L.isExternal(id)) {
                const groups = state.boxes[loc.box];
                const mine = gi => groups[gi] && !L.isExternal(groups[gi][0]);
                button('Separar do grupo', groups[loc.gi].length > 1
                    ? L.dropItem(state, id, zone, {kind: 'group', box: loc.box, gi: loc.gi}, null) : null);
                button('◀ Juntar com a peça da esquerda', mine(loc.gi - 1)
                    ? L.joinGroup(state, id, loc.box, loc.gi - 1, groups[loc.gi - 1].length) : null);
                button('Juntar com a peça da direita ▶', mine(loc.gi + 1)
                    ? L.joinGroup(state, id, loc.box, loc.gi + 1, 0) : null);
            }
        }

        const sides = new Gtk.Box({homogeneous: true, css_classes: ['linked'], margin_top: 4});
        const tokens = L.flatten(state);
        for (const z of L.ZONES) {
            // Item vai para o fim da última caixa de itens daquele lado, se houver.
            const last = tokens[z][tokens[z].length - 1] ?? null;
            const lastGroup = [...tokens[z]].reverse().find(t => t.kind === 'group') ?? null;
            const next = z === zone ? null : kind === 'el'
                ? L.dropElement(state, id, z, last, null)
                : L.dropItem(state, id, z, lastGroup ?? last, null);
            const btn = new Gtk.ToggleButton({label: L.ZONE_TITLES[z], active: z === zone,
                sensitive: z === zone || !!next});
            btn.connect('clicked', () => {
                pop.popdown();
                if (next)
                    save(next);
                else
                    btn.active = z === zone;
            });
            sides.append(btn);
        }
        col.append(sides);

        const sw = new Gtk.Box({spacing: 12, margin_top: 4});
        sw.append(new Gtk.Label({label: 'Mostrar no painel', hexpand: true, xalign: 0}));
        const toggle = new Gtk.Switch({active: !d.off, valign: Gtk.Align.CENTER});
        toggle.connect('notify::active', () => {
            if (kind === 'el')
                save({...state, visible: {...state.visible, [id]: toggle.active}});
            else
                L.setHidden(settings, id, !toggle.active);
        });
        sw.append(toggle);
        col.append(sw);

        pop.set_child(col);
        return pop;
    };

    // --- peças ---

    const makeChip = (payload, inHiddenArea = false) => {
        const d = describe(payload);
        const chip = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 3,
            css_classes: ['zf-chip'],
            tooltip_text: d.title,
            valign: Gtk.Align.CENTER,
        });
        chip._zfId = splitPayload(payload)[1];
        chip.append(new Gtk.Image({...iconFor(d.icon), pixel_size: 20}));
        chip.append(new Gtk.Label({label: d.short, css_classes: ['zf-chip-label']}));
        chip.set_cursor(Gdk.Cursor.new_from_name('grab', null));

        const click = new Gtk.GestureClick();
        click.connect('released', () => {
            if (inHiddenArea) {
                setShown(payload, true);
                return;
            }
            chip._zfPop?.unparent();
            chip._zfPop = makePopover(payload);
            chip._zfPop.set_parent(chip);
            chip._zfPop.popup();
        });
        chip.add_controller(click);

        const drag = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        drag.connect('prepare', () => Gdk.ContentProvider.new_for_value(stringValue(payload)));
        drag.connect('drag-begin', src => {
            src.set_icon(new Gtk.WidgetPaintable({widget: chip}), 20, 20);
            chip.add_css_class('zf-chip-dragging');
        });
        drag.connect('drag-end', () => {
            chip.remove_css_class('zf-chip-dragging');
            clearFeedback();
        });
        chip.add_controller(drag);
        return chip;
    };

    for (const zone of L.ZONES) {
        const zoneBox = new Gtk.Box({spacing: 8, css_classes: ['zf-zone']});
        zoneBox.append(new Gtk.Label({label: L.ZONE_TITLES[zone], css_classes: ['zf-zone-title'],
            width_chars: 8, xalign: 0, valign: Gtk.Align.CENTER}));
        // Muitas peças num lado: quebram linha (a janela limita a largura).
        const row = new WrapBox({valign: Gtk.Align.CENTER, hexpand: true});
        zoneBox.append(row);
        zones[zone] = {zoneBox, row, nodes: []};

        const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
        drop.set_preload(true); // conteúdo já no 'motion', para destacar só o que pode
        const rowXY = (x, y) => {
            const [, rx, ry] = zoneBox.translate_coordinates(row, x, y);
            return [rx, ry];
        };
        const hover = (target, x, y) => {
            clearFeedback();
            const value = target.get_value();
            if (typeof value !== 'string')
                return Gdk.DragAction.MOVE; // conteúdo ainda chegando
            const r = resolve(value, zone, ...rowXY(x, y));
            if (!r.next)
                return 0;
            r.show();
            return Gdk.DragAction.MOVE;
        };
        drop.connect('enter', (t, x, y) => {
            zoneBox.add_css_class('zf-zone-hover');
            return hover(t, x, y);
        });
        drop.connect('motion', (t, x, y) => hover(t, x, y));
        drop.connect('leave', () => {
            zoneBox.remove_css_class('zf-zone-hover');
            clearFeedback();
        });
        drop.connect('drop', (_t, value, x, y) => {
            zoneBox.remove_css_class('zf-zone-hover');
            clearFeedback();
            if (typeof value !== 'string')
                return false;
            const r = resolve(value, zone, ...rowXY(x, y));
            if (!r.next)
                return false;
            // Escreve depois que o arrastar terminar: a mudança recria as peças.
            const wasOff = isOff(value);
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                const [kind, id] = splitPayload(value);
                if (wasOff && kind === 'el') {
                    save({...r.next, visible: {...r.next.visible, [id]: true}});
                } else {
                    save(r.next);
                    if (wasOff)
                        L.setHidden(settings, id, false);
                }
                return GLib.SOURCE_REMOVE;
            });
            return true;
        });
        zoneBox.add_controller(drop);
        bar.append(zoneBox);
    }

    const hiddenDrop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
    hiddenDrop.connect('enter', () => {
        hiddenArea.add_css_class('zf-hidden-hover');
        return Gdk.DragAction.MOVE;
    });
    hiddenDrop.connect('leave', () => hiddenArea.remove_css_class('zf-hidden-hover'));
    hiddenDrop.connect('drop', (_t, value) => {
        hiddenArea.remove_css_class('zf-hidden-hover');
        if (typeof value !== 'string' || isOff(value))
            return false;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            setShown(value, false);
            return GLib.SOURCE_REMOVE;
        });
        return true;
    });
    hiddenArea.add_controller(hiddenDrop);

    const build = () => {
        clearFeedback();
        readState();
        const tokens = L.flatten(state);
        const offList = [];
        for (const zone of L.ZONES) {
            const z = zones[zone];
            for (const n of z.nodes) {
                n.chips.forEach(c => c._zfPop?.unparent());
                z.row.remove(n.frame);
            }
            z.nodes = [];
            for (const token of tokens[zone]) {
                const all = token.kind === 'el' ? [`el:${token.el}`] : token.ids.map(id => `item:${id}`);
                all.filter(isOff).forEach(p => offList.push(p));
                const shown = all.filter(p => !isOff(p));
                if (!shown.length)
                    continue;
                const frame = new Gtk.Box({spacing: 2, css_classes: ['zf-group-frame']});
                if (token.kind === 'el')
                    frame.add_css_class('zf-sys-frame');
                else if (L.isExternal(token.ids[0]))
                    frame.add_css_class('zf-ext-frame');
                const chips = shown.map(p => makeChip(p));
                chips.forEach(c => frame.append(c));
                z.row.append(frame);
                z.nodes.push({token, frame, chips});
            }
        }

        for (const child of [...hiddenChildren])
            hiddenArea.remove(child);
        hiddenChildren = offList.map(p => {
            const chip = makeChip(p, true);
            chip.tooltip_text = `${describe(p).title} — clique para mostrar`;
            hiddenArea.append(chip);
            return chip.get_parent(); // o FlowBoxChild
        });
        hiddenArea.visible = true;
        hiddenTitle.label = offList.length
            ? 'Escondidos — arraste para o painel ou clique para mostrar; arraste peças da barra para cá para esconder'
            : 'Escondidos — arraste peças da barra para cá para esconder';
    };

    let rebuildId = 0;
    const queueBuild = () => {
        if (rebuildId)
            return;
        rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            rebuildId = 0;
            build();
            return GLib.SOURCE_REMOVE;
        });
    };
    const ids = ['panel-layout', 'panel-hidden', 'panel-foreign'].map(key =>
        settings.connect(`changed::${key}`, queueBuild));
    const taskbarId = taskbar?.connect('changed::panel-element-positions', queueBuild);
    group.connect('destroy', () => {
        ids.forEach(id => settings.disconnect(id));
        if (taskbarId)
            taskbar.disconnect(taskbarId);
    });

    build();
    return group;
}
