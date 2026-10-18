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
// O que está escondido aparece apagado no lugar onde voltaria.

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
    padding: 4px;
    min-height: 74px;
    border: 2px dashed transparent;
}
.zf-zone-title {
    font-size: 0.8em;
    opacity: 0.6;
    margin-bottom: 4px;
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
.zf-chip-off {
    opacity: 0.35;
}
.zf-chip-dragging {
    opacity: 0.2;
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
    return ok ? {x: rect.get_x(), w: rect.get_width()} : null;
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

    const bar = new Gtk.Box({spacing: 6, css_classes: ['zf-panel-bar']});
    const scroller = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        vscrollbar_policy: Gtk.PolicyType.NEVER,
        propagate_natural_height: true,
        child: bar,
    });
    group.add(scroller);

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
            return {title, short: title.split(/[\s(]/)[0].slice(0, 10), icon: f?.icon, off: hidden.has(id)};
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
    const resolve = (payload, zone, x) => {
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
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const b = bounds(n.frame, z.row);
            if (!b)
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
            const [, fx] = z.row.translate_coordinates(n.frame, x, 0);
            const index = indexAmong(n.chips, n.frame, fx);
            return {
                next: L.joinGroup(state, id, n.token.box, n.token.gi, index),
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

    const makeChip = payload => {
        const d = describe(payload);
        const chip = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 3,
            css_classes: ['zf-chip'],
            tooltip_text: d.off ? `${d.title} (escondido)` : d.title,
            valign: Gtk.Align.CENTER,
        });
        if (d.off)
            chip.add_css_class('zf-chip-off');
        chip.append(new Gtk.Image({...iconFor(d.icon), pixel_size: 20}));
        chip.append(new Gtk.Label({label: d.short, css_classes: ['zf-chip-label']}));
        chip.set_cursor(Gdk.Cursor.new_from_name('grab', null));

        const click = new Gtk.GestureClick();
        click.connect('released', () => {
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
        const zoneBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['zf-zone'],
            hexpand: true, width_request: 56});
        zoneBox.append(new Gtk.Label({label: L.ZONE_TITLES[zone], css_classes: ['zf-zone-title'],
            xalign: zone === 'left' ? 0 : zone === 'right' ? 1 : 0.5}));
        const row = new Gtk.Box({
            spacing: 12,
            halign: zone === 'left' ? Gtk.Align.START : zone === 'right' ? Gtk.Align.END : Gtk.Align.CENTER,
            vexpand: true,
        });
        zoneBox.append(row);
        zones[zone] = {zoneBox, row, nodes: []};

        const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
        drop.set_preload(true); // conteúdo já no 'motion', para destacar só o que pode
        const rowX = (x, y) => zoneBox.translate_coordinates(row, x, y)[1];
        const hover = (target, x, y) => {
            clearFeedback();
            const value = target.get_value();
            if (typeof value !== 'string')
                return Gdk.DragAction.MOVE; // conteúdo ainda chegando
            const r = resolve(value, zone, rowX(x, y));
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
            const r = resolve(value, zone, rowX(x, y));
            if (!r.next)
                return false;
            // Escreve depois que o arrastar terminar: a mudança recria as peças.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                save(r.next);
                return GLib.SOURCE_REMOVE;
            });
            return true;
        });
        zoneBox.add_controller(drop);
        bar.append(zoneBox);
    }

    const build = () => {
        clearFeedback();
        readState();
        const tokens = L.flatten(state);
        for (const zone of L.ZONES) {
            const z = zones[zone];
            for (const n of z.nodes) {
                n.chips.forEach(c => c._zfPop?.unparent());
                z.row.remove(n.frame);
            }
            z.nodes = tokens[zone].map(token => {
                const frame = new Gtk.Box({spacing: 2, css_classes: ['zf-group-frame'], valign: Gtk.Align.CENTER});
                let payloads;
                if (token.kind === 'el') {
                    frame.add_css_class('zf-sys-frame');
                    payloads = [`el:${token.el}`];
                } else {
                    if (L.isExternal(token.ids[0]))
                        frame.add_css_class('zf-ext-frame');
                    payloads = token.ids.map(id => `item:${id}`);
                }
                const chips = payloads.map(makeChip);
                chips.forEach(c => frame.append(c));
                z.row.append(frame);
                return {token, frame, chips};
            });
        }
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
