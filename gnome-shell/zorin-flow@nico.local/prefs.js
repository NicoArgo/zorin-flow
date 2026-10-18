import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {panelEditorGroup} from './prefsPanel.js';

const SWITCHES = [
    ['Terminal', [
        ['terminal-borders', 'Contorno na cor da pasta', 'Borda colorida em volta da janela do terminal quando a pasta tem regra'],
        ['terminal-rule-button', 'Botão "Regra da pasta" no terminal', 'No canto do terminal em foco: mostra a regra da pasta e abre o diálogo para criar ou mudar'],
    ]],
    ['Janelas', [
        ['alttab-close', 'Fechar pelo Alt+Tab', 'X na miniatura selecionada ou sob o mouse; clique do meio também fecha'],
        ['desktop-corner', 'Canto inferior esquerdo → área de trabalho', 'Clicar na quina mostra a área de trabalho; clicar de novo devolve as janelas'],
        ['desktop-corner-right', 'Canto inferior direito → área de trabalho', 'Basta encostar o mouse na quina; encostar de novo devolve as janelas'],
    ]],
    ['Área de transferência', [
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
        page.add(panelEditorGroup(settings));

        for (const [title, rows] of SWITCHES) {
            const group = new Adw.PreferencesGroup({title});
            if (title === 'Área de transferência')
                group.description = 'O histórico (Super+V) funciona enquanto o item Transfer. estiver visível no painel. Só texto, só na memória; senhas marcadas são ignoradas.';
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
        }

        const rules = new Adw.PreferencesGroup({
            title: 'Regras por pasta',
            description: 'Botão direito numa pasta no Arquivos → "Regra da pasta…", ou no terminal: zflow-rule set . --name Nome --color "#2ec4d6"',
        });
        page.add(rules);
        window.add(page);
    }
}
