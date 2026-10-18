// Editor visual do painel: uma barra que imita o painel, com três zonas
// (Esquerda, Centro, Direita). Cada moldura é um grupo — os itens dentro dela
// ficam colados num mesmo botão do painel.
//
// Arrastar um item:
//   - para dentro de uma moldura   → entra naquele grupo (na posição marcada)
//   - para o espaço entre molduras → vira um item independente ali
// Clicar num item abre: separar do grupo, juntar com o vizinho, lado e
// mostrar/esconder. Itens escondidos aparecem apagados no lugar onde voltariam.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {BOXES, BOX_TITLES, ITEMS, locate, moveItem, readHidden, readLayout, setHidden, writeLayout} from './layout.js';

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

const GROUP_EDGE = 12; // px nas bordas da moldura que contam como "fora" (separar)

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

// Antes de qual filho (pelo meio dele) o cursor está.
function indexAmong(widgets, relativeTo, x) {
    for (let i = 0; i < widgets.length; i++) {
        const b = bounds(widgets[i], relativeTo);
        if (b && x < b.x + b.w / 2)
            return i;
    }
    return widgets.length;
}

export function panelEditorGroup(settings) {
    const provider = new Gtk.CssProvider();
    provider.load_from_string(CSS);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    const group = new Adw.PreferencesGroup({
        title: 'Painel',
        description: 'Cada moldura é um grupo de itens colados no painel. Arraste um item para dentro ' +
            'de uma moldura para agrupar, ou para o espaço entre elas para deixá-lo independente. ' +
            'Clique num item para mais opções.',
    });

    const bar = new Gtk.Box({spacing: 6, css_classes: ['zf-panel-bar']});
    // Com muitos grupos a barra passa da largura da janela: rola de lado.
    const scroller = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        vscrollbar_policy: Gtk.PolicyType.NEVER,
        propagate_natural_height: true,
        child: bar,
    });
    group.add(scroller);

    const info = Object.fromEntries(ITEMS.map(i => [i.id, i]));
    const zones = {};
    // Destaque do destino: classes que só desenham sombra, sem ocupar espaço,
    // para o alvo não pular enquanto o item é arrastado.
    let marked = [];

    const apply = (id, target) => writeLayout(settings, moveItem(readLayout(settings), id, target));

    const mark = (widget, cls) => {
        widget.add_css_class(cls);
        marked.push([widget, cls]);
    };

    const clearFeedback = () => {
        for (const [widget, cls] of marked)
            widget.remove_css_class(cls);
        marked = [];
    };

    // Faixa antes do elemento `index` de `list` (ou depois do último).
    const markSlot = (list, index) => {
        if (index < list.length)
            mark(list[index], 'zf-drop-before');
        else if (list.length)
            mark(list[list.length - 1], 'zf-drop-after');
    };

    // Onde o item cairia na zona `box`, com o cursor em `x` (coordenadas da fileira).
    const dropTarget = (box, x) => {
        const z = zones[box];
        for (let g = 0; g < z.frames.length; g++) {
            const b = bounds(z.frames[g], z.row);
            if (!b)
                continue;
            if (x < b.x)
                return {box, type: 'new', index: g};
            if (x <= b.x + b.w) {
                const edge = Math.min(GROUP_EDGE, b.w / 4);
                if (x < b.x + edge)
                    return {box, type: 'new', index: g};
                if (x > b.x + b.w - edge)
                    return {box, type: 'new', index: g + 1};
                const [, fx] = z.row.translate_coordinates(z.frames[g], x, 0);
                return {box, type: 'join', group: g, index: indexAmong(z.chips[g], z.frames[g], fx)};
            }
        }
        return {box, type: 'new', index: z.frames.length};
    };

    const showFeedback = target => {
        clearFeedback();
        const z = zones[target.box];
        if (target.type === 'join') {
            mark(z.frames[target.group], 'zf-group-target');
            markSlot(z.chips[target.group], target.index);
        } else {
            markSlot(z.frames, target.index);
        }
    };

    const makePopover = id => {
        const layout = readLayout(settings);
        const [box, g] = locate(layout, id);
        const groups = layout[box];
        const pop = new Gtk.Popover();
        const col = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6,
            margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
        col.append(new Gtk.Label({label: info[id].title, css_classes: ['heading'], xalign: 0}));

        const action = (label, sensitive, target) => {
            const b = new Gtk.Button({label, sensitive});
            b.connect('clicked', () => {
                pop.popdown();
                apply(id, target);
            });
            col.append(b);
        };
        action('Separar do grupo', groups[g].length > 1, {box, type: 'new', index: g + 1});
        action('◀ Juntar com o grupo da esquerda', g > 0,
            {box, type: 'join', group: g - 1, index: groups[g - 1]?.length ?? 0});
        action('Juntar com o grupo da direita ▶', g < groups.length - 1,
            {box, type: 'join', group: g + 1, index: 0});

        const sides = new Gtk.Box({homogeneous: true, css_classes: ['linked'], margin_top: 4});
        for (const b of BOXES) {
            const btn = new Gtk.ToggleButton({label: BOX_TITLES[b], active: b === box});
            btn.connect('clicked', () => {
                pop.popdown();
                if (b !== box)
                    apply(id, {box: b, type: 'new', index: layout[b].length});
                else
                    btn.active = true;
            });
            sides.append(btn);
        }
        col.append(sides);

        const sw = new Gtk.Box({spacing: 12, margin_top: 4});
        sw.append(new Gtk.Label({label: 'Mostrar no painel', hexpand: true, xalign: 0}));
        const toggle = new Gtk.Switch({active: !readHidden(settings).has(id), valign: Gtk.Align.CENTER});
        toggle.connect('notify::active', () => setHidden(settings, id, !toggle.active));
        sw.append(toggle);
        col.append(sw);

        pop.set_child(col);
        return pop;
    };

    const makeChip = (id, hidden) => {
        const it = info[id];
        const chip = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 3,
            css_classes: ['zf-chip'],
            tooltip_text: hidden ? `${it.title} (escondido)` : it.title,
            valign: Gtk.Align.CENTER,
        });
        if (hidden)
            chip.add_css_class('zf-chip-off');
        chip.append(new Gtk.Image({icon_name: it.icon, pixel_size: 20}));
        chip.append(new Gtk.Label({label: it.short, css_classes: ['zf-chip-label']}));
        chip.set_cursor(Gdk.Cursor.new_from_name('grab', null));

        // O popover é montado na hora do clique, com o layout daquele momento.
        const click = new Gtk.GestureClick();
        click.connect('released', () => {
            chip._zfPop?.unparent();
            chip._zfPop = makePopover(id);
            chip._zfPop.set_parent(chip);
            chip._zfPop.popup();
        });
        chip.add_controller(click);

        const drag = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        drag.connect('prepare', () => Gdk.ContentProvider.new_for_value(stringValue(id)));
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

    for (const box of BOXES) {
        const zone = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['zf-zone'], hexpand: true, width_request: 72});
        zone.append(new Gtk.Label({label: BOX_TITLES[box], css_classes: ['zf-zone-title'],
            xalign: box === 'left' ? 0 : box === 'right' ? 1 : 0.5}));
        const row = new Gtk.Box({
            spacing: 12,
            halign: box === 'left' ? Gtk.Align.START : box === 'right' ? Gtk.Align.END : Gtk.Align.CENTER,
            vexpand: true,
        });
        zone.append(row);
        zones[box] = {zone, row, frames: [], chips: []};

        const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
        const rowX = (x, y) => zone.translate_coordinates(row, x, y)[1];
        drop.connect('enter', (_t, x, y) => {
            zone.add_css_class('zf-zone-hover');
            showFeedback(dropTarget(box, rowX(x, y)));
            return Gdk.DragAction.MOVE;
        });
        drop.connect('motion', (_t, x, y) => {
            showFeedback(dropTarget(box, rowX(x, y)));
            return Gdk.DragAction.MOVE;
        });
        drop.connect('leave', () => {
            zone.remove_css_class('zf-zone-hover');
            clearFeedback();
        });
        drop.connect('drop', (_t, value, x, y) => {
            zone.remove_css_class('zf-zone-hover');
            if (typeof value !== 'string')
                return false;
            clearFeedback();
            const target = dropTarget(box, rowX(x, y));
            // Escreve depois que o arrastar terminar: a mudança recria os itens.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                apply(value, target);
                return GLib.SOURCE_REMOVE;
            });
            return true;
        });
        zone.add_controller(drop);
        bar.append(zone);
    }

    const build = () => {
        clearFeedback();
        const layout = readLayout(settings);
        const hidden = readHidden(settings);
        for (const box of BOXES) {
            const z = zones[box];
            for (const chips of z.chips)
                chips.forEach(c => c._zfPop?.unparent());
            for (const frame of z.frames)
                z.row.remove(frame);
            z.frames = [];
            z.chips = [];
            for (const ids of layout[box]) {
                const frame = new Gtk.Box({spacing: 2, css_classes: ['zf-group-frame'], valign: Gtk.Align.CENTER});
                const chips = ids.map(id => makeChip(id, hidden.has(id)));
                chips.forEach(c => frame.append(c));
                z.row.append(frame);
                z.frames.push(frame);
                z.chips.push(chips);
            }
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
    const ids = ['panel-layout', 'panel-hidden'].map(key => settings.connect(`changed::${key}`, queueBuild));
    group.connect('destroy', () => ids.forEach(id => settings.disconnect(id)));

    build();
    return group;
}
