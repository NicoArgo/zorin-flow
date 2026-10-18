// Mostrar área de trabalho, compartilhado pelo botão do painel e pelo canto.
//
// Minimiza as janelas da área de trabalho atual (de uma tela, ou de todas) e,
// no próximo acionamento, devolve exatamente as que foram minimizadas aqui, na
// mesma ordem de empilhamento. O Super+D do sistema segue independente.

import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ALL = -1;
let hidden = []; // MetaWindow minimizadas aqui, do fundo para o topo

function onMonitor(win, monitor) {
    return monitor === ALL || win.get_monitor() === monitor;
}

export function hasHidden(monitor = ALL) {
    return hidden.some(w => w.minimized && onMonitor(w, monitor));
}

export function toggleDesktop(monitor = ALL) {
    const ws = global.workspace_manager.get_active_workspace();
    const visible = ws.list_windows().filter(w =>
        !w.minimized &&
        w.get_window_type() === Meta.WindowType.NORMAL &&
        !w.is_skip_taskbar() &&
        !w.is_on_all_workspaces() &&
        onMonitor(w, monitor));

    if (visible.length) {
        const sorted = global.display.sort_windows_by_stacking(visible);
        hidden = [...hidden.filter(w => w.minimized && !sorted.includes(w)), ...sorted];
        for (const w of sorted)
            w.minimize();
        return;
    }

    const toRestore = hidden.filter(w =>
        w.minimized && w.get_workspace?.() === ws && onMonitor(w, monitor));
    hidden = hidden.filter(w => !toRestore.includes(w));
    for (const w of toRestore)
        w.unminimize();
    if (toRestore.length)
        Main.activateWindow(toRestore[toRestore.length - 1]);
}

export function forgetHidden() {
    hidden = [];
}
