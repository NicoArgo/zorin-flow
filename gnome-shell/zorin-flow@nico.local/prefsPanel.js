// Editor visual da posição dos applets: uma barra que imita o painel, com três
// zonas (Esquerda, Centro, Direita) e um chip por applet. Arraste um chip para
// outra posição ou outra zona; ou clique nele para movê-lo pelos botões.
// Applets desligados aparecem apagados, no lugar onde voltariam.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {APPLETS, BOXES, BOX_TITLES, readLayout, writeLayout} from './layout.js';

const CSS = `
.zf-panel-bar {
    background-color: alpha(@window_fg_color, 0.07);
    border-radius: 12px;
    padding: 8px;
}
.zf-zone {
    border-radius: 9px;
    padding: 6px;
    min-height: 64px;
    border: 2px dashed transparent;
}
.zf-zone-title {
    font-size: 0.8em;
    opacity: 0.6;
    margin-bottom: 4px;
}
.zf-zone-hover {
    border-color: @accent_color;
    background-color: alpha(@accent_color, 0.10);
}
.zf-chip {
    padding: 6px 8px;
    border-radius: 8px;
    background-color: alpha(@window_fg_color, 0.10);
    min-width: 48px;
}
.zf-chip:hover {
    background-color: alpha(@window_fg_color, 0.18);
}
.zf-chip-label {
    font-size: 0.78em;
}
.zf-chip-off {
    opacity: 0.4;
}
.zf-chip-dragging {
    opacity: 0.25;
}
.zf-drop-marker {
    background-color: @accent_color;
    min-width: 3px;
    border-radius: 2px;
}
`;

const ENABLE_KEYS = {
    terminals: 'show-terminals',
    places: 'show-places',
    tiling: 'show-tiling',
    settings: 'show-settings',
    clipboard: 'clipboard-enabled',
    vampire: 'show-vampire',
};

function stringValue(text) {
    const value = new GObject.Value();
    value.init(GObject.TYPE_STRING);
    value.set_string(text);
    return value;
}

// Posição de inserção numa zona a partir do x do cursor: antes do primeiro
// chip cujo meio está à direita do cursor.
function insertIndex(zoneBox, chips, x) {
    for (let i = 0; i < chips.length; i++) {
        const [ok, rect] = chips[i].compute_bounds(zoneBox);
        if (ok && x < rect.get_x() + rect.get_width() / 2)
            return i;
    }
    return chips.length;
}

export function panelEditorGroup(settings) {
    const provider = new Gtk.CssProvider();
    provider.load_from_string(CSS);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    const group = new Adw.PreferencesGroup({
        title: 'Posição no painel',
        description: 'Arraste os applets para mudar o lado e a ordem — ou clique num deles. O painel muda na hora.',
    });

    const bar = new Gtk.Box({spacing: 8, css_classes: ['zf-panel-bar']});
    group.add(bar);

    const info = Object.fromEntries(APPLETS.map(a => [a.role, a]));
    const zones = {};

    const move = (role, toBox, toIndex) => {
        const layout = readLayout(settings);
        const fromBox = BOXES.find(b => layout[b].includes(role));
        const from = layout[fromBox].indexOf(role);
        layout[fromBox].splice(from, 1);
        // Na mesma zona, tirar o chip desloca quem vinha depois dele.
        if (fromBox === toBox && toIndex > from)
            toIndex--;
        layout[toBox].splice(Math.max(0, Math.min(toIndex, layout[toBox].length)), 0, role);
        writeLayout(settings, layout);
    };

    const makePopover = (role, box, index, count) => {
        const pop = new Gtk.Popover();
        const col = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6,
            margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
        col.append(new Gtk.Label({label: info[role].title, css_classes: ['heading'], xalign: 0}));

        const order = new Gtk.Box({spacing: 6, homogeneous: true});
        for (const [label, delta] of [['◀ Antes', -1], ['Depois ▶', 2]]) {
            const target = index + delta;
            const b = new Gtk.Button({label, sensitive: delta < 0 ? index > 0 : index < count - 1});
            b.connect('clicked', () => {
                pop.popdown();
                move(role, box, target);
            });
            order.append(b);
        }
        col.append(order);

        const sides = new Gtk.Box({spacing: 6, homogeneous: true, css_classes: ['linked']});
        for (const b of BOXES) {
            const btn = new Gtk.ToggleButton({label: BOX_TITLES[b], active: b === box});
            btn.connect('clicked', () => {
                pop.popdown();
                if (b !== box)
                    move(role, b, Number.MAX_SAFE_INTEGER);
                else
                    btn.active = true;
            });
            sides.append(btn);
        }
        col.append(sides);

        const key = ENABLE_KEYS[role];
        if (key) {
            const sw = new Gtk.Box({spacing: 12});
            sw.append(new Gtk.Label({label: 'Mostrar no painel', hexpand: true, xalign: 0}));
            const toggle = new Gtk.Switch({active: settings.get_boolean(key), valign: Gtk.Align.CENTER});
            toggle.connect('notify::active', () => settings.set_boolean(key, toggle.active));
            sw.append(toggle);
            col.append(sw);
        }
        pop.set_child(col);
        return pop;
    };

    const makeChip = (role, box, index, count) => {
        const a = info[role];
        const chip = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 3,
            css_classes: ['zf-chip'],
            tooltip_text: a.title,
            valign: Gtk.Align.CENTER,
        });
        const key = ENABLE_KEYS[role];
        if (key && !settings.get_boolean(key)) {
            chip.add_css_class('zf-chip-off');
            chip.tooltip_text = `${a.title} (desligado)`;
        }
        chip.append(new Gtk.Image({icon_name: a.icon, pixel_size: 20}));
        chip.append(new Gtk.Label({label: a.short, css_classes: ['zf-chip-label']}));
        chip.set_cursor(Gdk.Cursor.new_from_name('grab', null));

        // Clique: menu com mover antes/depois, lado e liga/desliga.
        const pop = makePopover(role, box, index, count);
        pop.set_parent(chip);
        chip._zfPop = pop;
        const click = new Gtk.GestureClick();
        click.connect('released', () => pop.popup());
        chip.add_controller(click);

        // Arrastar.
        const drag = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        drag.connect('prepare', () => Gdk.ContentProvider.new_for_value(stringValue(role)));
        drag.connect('drag-begin', (src) => {
            src.set_icon(new Gtk.WidgetPaintable({widget: chip}), 20, 20);
            chip.add_css_class('zf-chip-dragging');
        });
        drag.connect('drag-end', () => chip.remove_css_class('zf-chip-dragging'));
        chip.add_controller(drag);
        return chip;
    };

    for (const box of BOXES) {
        const zone = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['zf-zone'], hexpand: true});
        zone.append(new Gtk.Label({label: BOX_TITLES[box], css_classes: ['zf-zone-title'],
            xalign: box === 'left' ? 0 : box === 'right' ? 1 : 0.5}));
        const row = new Gtk.Box({
            spacing: 6,
            halign: box === 'left' ? Gtk.Align.START : box === 'right' ? Gtk.Align.END : Gtk.Align.CENTER,
            vexpand: true,
        });
        zone.append(row);
        const marker = new Gtk.Box({css_classes: ['zf-drop-marker'], visible: false});
        zones[box] = {zone, row, marker, chips: []};

        const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
        const placeMarker = (x, y) => {
            const z = zones[box];
            const [, px] = zone.translate_coordinates(row, x, y);
            const i = insertIndex(row, z.chips, px);
            if (marker.get_parent() !== row)
                row.append(marker);
            row.reorder_child_after(marker, i === 0 ? null : z.chips[i - 1]);
            marker.visible = true;
            return i;
        };
        drop.connect('enter', (_t, x, y) => {
            zone.add_css_class('zf-zone-hover');
            placeMarker(x, y);
            return Gdk.DragAction.MOVE;
        });
        drop.connect('motion', (_t, x, y) => {
            placeMarker(x, y);
            return Gdk.DragAction.MOVE;
        });
        drop.connect('leave', () => {
            zone.remove_css_class('zf-zone-hover');
            marker.visible = false;
        });
        drop.connect('drop', (_t, value, x, y) => {
            if (typeof value !== 'string')
                return false;
            zone.remove_css_class('zf-zone-hover');
            marker.visible = false;
            const [, px] = zone.translate_coordinates(row, x, y);
            const i = insertIndex(row, zones[box].chips, px);
            // Escreve depois que o arrastar terminar: a mudança recria os chips.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                move(value, box, i);
                return GLib.SOURCE_REMOVE;
            });
            return true;
        });
        zone.add_controller(drop);
        bar.append(zone);
    }

    const build = () => {
        const layout = readLayout(settings);
        for (const box of BOXES) {
            const z = zones[box];
            for (const chip of z.chips) {
                chip._zfPop.unparent();
                z.row.remove(chip);
            }
            z.chips = layout[box].map((role, i) => makeChip(role, box, i, layout[box].length));
            for (const chip of z.chips)
                z.row.append(chip);
            z.marker.visible = false;
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
    const keys = [...BOXES.map(b => `panel-${b}`), ...Object.values(ENABLE_KEYS)];
    const ids = keys.map(key => settings.connect(`changed::${key}`, queueBuild));
    group.connect('destroy', () => ids.forEach(id => settings.disconnect(id)));

    build();
    return group;
}
