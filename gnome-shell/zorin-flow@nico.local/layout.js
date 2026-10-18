// Onde cada applet fica no painel: lado (esquerda/centro/direita) e ordem.
// Usado pela extensão e pela tela de configurações — por isso sem nada do Shell.
//
// Guardado em três listas (panel-left, panel-center, panel-right), na ordem em
// que os applets aparecem. Um applet que não está em nenhuma lista (porque é
// novo) entra no fim do seu lado padrão.

export const APPLETS = [
    {role: 'terminals', title: 'Terminais', box: 'left'},
    {role: 'places', title: 'Imagens, Downloads e Área de trabalho', box: 'left'},
    {role: 'tiling', title: 'Tiling automático', box: 'left'},
    {role: 'clipboard', title: 'Área de transferência', box: 'right'},
    {role: 'vampire', title: 'Modo vampiro', box: 'right'},
];

export const BOXES = ['left', 'center', 'right'];
export const BOX_TITLES = {left: 'Esquerda', center: 'Centro', right: 'Direita'};

const known = new Set(APPLETS.map(a => a.role));

export function readLayout(settings) {
    const layout = {};
    const seen = new Set();
    for (const box of BOXES) {
        layout[box] = settings.get_strv(`panel-${box}`).filter(role => {
            if (!known.has(role) || seen.has(role))
                return false;
            seen.add(role);
            return true;
        });
    }
    for (const a of APPLETS) {
        if (!seen.has(a.role))
            layout[a.box].push(a.role);
    }
    return layout;
}

export function writeLayout(settings, layout) {
    for (const box of BOXES)
        settings.set_strv(`panel-${box}`, layout[box]);
}
