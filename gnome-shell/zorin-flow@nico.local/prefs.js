import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {APPLETS, BOXES, BOX_TITLES, readLayout, writeLayout} from './layout.js';

// Lado e ordem de cada applet: um seletor de lado e setas para subir/descer
// dentro do lado. A extensão remonta o painel na hora.
function panelLayoutGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Posição no painel',
        description: 'Lado e ordem de cada applet; muda na hora',
    });
    const titles = Object.fromEntries(APPLETS.map(a => [a.role, a.title]));
    let rows = [];
    let rebuildId = 0;

    const move = (role, toBox, delta) => {
        const layout = readLayout(settings);
        const fromBox = BOXES.find(b => layout[b].includes(role));
        const list = layout[fromBox];
        const i = list.indexOf(role);
        if (toBox !== fromBox) {
            list.splice(i, 1);
            layout[toBox].push(role);
        } else {
            const j = i + delta;
            if (j < 0 || j >= list.length)
                return;
            [list[i], list[j]] = [list[j], list[i]];
        }
        writeLayout(settings, layout);
    };

    const build = () => {
        for (const row of rows)
            group.remove(row);
        rows = [];
        const layout = readLayout(settings);
        for (const box of BOXES) {
            layout[box].forEach((role, i) => {
                const row = new Adw.ActionRow({title: titles[role]});

                const side = Gtk.DropDown.new_from_strings(BOXES.map(b => BOX_TITLES[b]));
                side.selected = BOXES.indexOf(box);
                side.valign = Gtk.Align.CENTER;
                side.connect('notify::selected', () => move(role, BOXES[side.selected], 0));
                row.add_suffix(side);

                for (const [icon, delta, enabled] of [
                    ['go-up-symbolic', -1, i > 0],
                    ['go-down-symbolic', 1, i < layout[box].length - 1],
                ]) {
                    const btn = new Gtk.Button({
                        icon_name: icon,
                        valign: Gtk.Align.CENTER,
                        sensitive: enabled,
                        css_classes: ['flat'],
                        tooltip_text: delta < 0 ? 'Mais para a esquerda' : 'Mais para a direita',
                    });
                    btn.connect('clicked', () => move(role, box, delta));
                    row.add_suffix(btn);
                }
                group.add(row);
                rows.push(row);
            });
        }
    };

    // Reconstrói fora do handler que mudou a configuração (o widget que
    // disparou a mudança é um dos que serão trocados).
    for (const box of BOXES) {
        settings.connect(`changed::panel-${box}`, () => {
            if (rebuildId)
                return;
            rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                rebuildId = 0;
                build();
                return GLib.SOURCE_REMOVE;
            });
        });
    }
    build();
    return group;
}

const SWITCHES = [
    ['Terminal', [
        ['terminal-borders', 'Contorno na cor da pasta', 'Borda colorida em volta da janela do terminal quando a pasta tem regra'],
    ]],
    ['Janelas', [
        ['alttab-close', 'Fechar pelo Alt+Tab', 'X na miniatura selecionada ou sob o mouse; clique do meio também fecha'],
        ['show-tiling', 'Botão de tiling automático', 'Liga/desliga o auto-tiling do Zorin e escolhe o layout (Super+Y)'],
        ['desktop-corner', 'Canto inferior esquerdo → área de trabalho', 'Clicar na quina mostra a área de trabalho; clicar de novo devolve as janelas'],
        ['desktop-corner-right', 'Canto inferior direito → área de trabalho', 'Basta encostar o mouse na quina; encostar de novo devolve as janelas'],
    ]],
    ['Painel', [
        ['show-terminals', 'Applet de terminais', 'Botão de novo terminal e uma bolinha por janela, na cor da pasta'],
        ['show-places', 'Imagens, Downloads e Área de trabalho', 'Atalhos no painel'],
        ['show-vampire', 'Modo vampiro', 'O PC só dorme quando você manda (1 h, 3 h ou até desligar)'],
    ]],
    ['Área de transferência', [
        ['clipboard-enabled', 'Histórico (Super+V)', 'Só texto, só na memória; senhas marcadas são ignoradas'],
        ['clipboard-paste-on-select', 'Colar ao escolher', 'Como o Win+V: escolher um item já cola na janela'],
    ]],
    ['Tema', [
        ['wallsync', 'Destaque segue o papel de parede', 'Ao trocar o papel de parede, escolhe a cor do Zorin mais próxima'],
    ]],
];

export default class ZorinFlowPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        for (const [title, rows] of SWITCHES) {
            const group = new Adw.PreferencesGroup({title});
            for (const [key, rowTitle, subtitle] of rows) {
                const row = new Adw.SwitchRow({title: rowTitle, subtitle});
                settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
                group.add(row);
            }
            if (title === 'Terminal') {
                for (const [key, rowTitle, lower, upper] of [
                    ['terminal-border-width', 'Espessura do contorno', 1, 12],
                    ['terminal-border-radius', 'Arredondamento dos cantos', 0, 30],
                ]) {
                    const spin = new Adw.SpinRow({
                        title: rowTitle,
                        adjustment: new Gtk.Adjustment({lower, upper, step_increment: 1}),
                    });
                    settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
                    group.add(spin);
                }
            }
            if (title === 'Janelas') {
                const spin = new Adw.SpinRow({
                    title: 'Tamanho da área dos cantos (px)',
                    adjustment: new Gtk.Adjustment({lower: 2, upper: 40, step_increment: 1}),
                });
                settings.bind('desktop-corner-size', spin, 'value', Gio.SettingsBindFlags.DEFAULT);
                group.add(spin);
            }
            if (title === 'Área de transferência') {
                const size = new Adw.SpinRow({
                    title: 'Itens guardados',
                    adjustment: new Gtk.Adjustment({lower: 5, upper: 200, step_increment: 5}),
                });
                settings.bind('clipboard-size', size, 'value', Gio.SettingsBindFlags.DEFAULT);
                group.add(size);
            }
            page.add(group);
            if (title === 'Painel')
                page.add(panelLayoutGroup(settings));
        }

        const rules = new Adw.PreferencesGroup({
            title: 'Regras por pasta',
            description: 'Botão direito numa pasta no Arquivos → "Regra da pasta…", ou no terminal: zflow-rule set . --name Nome --color "#2ec4d6"',
        });
        page.add(rules);
        window.add(page);
    }
}
