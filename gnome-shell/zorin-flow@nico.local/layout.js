// Onde cada item fica no painel. Usado pela extensão e pela tela de
// configurações — por isso sem nada do Shell.
//
// Cada lado (esquerda/centro/direita) é uma lista de grupos; cada grupo é uma
// lista de itens que ficam colados num mesmo botão do painel. Um item sozinho
// é um grupo de um. Guardado como JSON em `panel-layout`; itens escondidos em
// `panel-hidden`. Um item que não aparece em lugar nenhum (porque é novo)
// entra como grupo próprio no fim do seu lado padrão.

export const ITEMS = [
    {id: 'terminal-new', title: 'Novo terminal', short: 'Terminal', icon: 'utilities-terminal-symbolic', box: 'left'},
    {id: 'terminal-dots', title: 'Bolinhas dos terminais (cor da pasta)', short: 'Bolinhas', icon: 'media-record-symbolic', box: 'left'},
    {id: 'pictures', title: 'Imagens', short: 'Imagens', icon: 'folder-pictures-symbolic', box: 'left'},
    {id: 'downloads', title: 'Downloads', short: 'Downloads', icon: 'folder-download-symbolic', box: 'left'},
    {id: 'desktop', title: 'Mostrar área de trabalho', short: 'Área trab.', icon: 'user-desktop-symbolic', box: 'left'},
    {id: 'tiling', title: 'Tiling automático', short: 'Tiling', icon: 'view-grid-symbolic', box: 'left'},
    {id: 'settings', title: 'Configurações do Zorin Flow', short: 'Config.', icon: 'emblem-system-symbolic', box: 'left'},
    {id: 'clipboard', title: 'Área de transferência (Super+V)', short: 'Transfer.', icon: 'edit-paste-symbolic', box: 'right'},
    {id: 'vampire', title: 'Modo vampiro', short: 'Vampiro', icon: 'weather-clear-night-symbolic', box: 'right'},
];

export const BOXES = ['left', 'center', 'right'];
export const BOX_TITLES = {left: 'Esquerda', center: 'Centro', right: 'Direita'};

const DEFAULT_LAYOUT = {
    left: [['terminal-new', 'terminal-dots'], ['pictures', 'downloads', 'desktop'], ['tiling'], ['settings']],
    center: [],
    right: [['clipboard'], ['vampire']],
};

// Formato antigo (um applet por grupo fixo) → itens.
const LEGACY_GROUPS = {
    terminals: ['terminal-new', 'terminal-dots'],
    places: ['pictures', 'downloads', 'desktop'],
};
const LEGACY_SHOW = {
    'show-terminals': LEGACY_GROUPS.terminals,
    'show-places': LEGACY_GROUPS.places,
    'show-tiling': ['tiling'],
    'show-settings': ['settings'],
    'clipboard-enabled': ['clipboard'],
    'show-vampire': ['vampire'],
};

const known = new Set(ITEMS.map(i => i.id));

function legacyLayout(settings) {
    const layout = {};
    let any = false;
    for (const box of BOXES) {
        const roles = settings.get_strv(`panel-${box}`);
        any ||= roles.length > 0;
        layout[box] = roles.map(r => LEGACY_GROUPS[r] ? [...LEGACY_GROUPS[r]] : [r]);
    }
    return any ? layout : structuredClone(DEFAULT_LAYOUT);
}

function normalize(raw) {
    const layout = {};
    const seen = new Set();
    for (const box of BOXES) {
        layout[box] = (Array.isArray(raw?.[box]) ? raw[box] : [])
            .map(group => (Array.isArray(group) ? group : []).filter(id => {
                if (!known.has(id) || seen.has(id))
                    return false;
                seen.add(id);
                return true;
            }))
            .filter(group => group.length);
    }
    for (const item of ITEMS) {
        if (!seen.has(item.id))
            layout[item.box].push([item.id]);
    }
    return layout;
}

export function readLayout(settings) {
    const json = settings.get_string('panel-layout');
    if (json) {
        try {
            return normalize(JSON.parse(json));
        } catch {
            // JSON estragado: volta ao padrão abaixo.
        }
    }
    return normalize(legacyLayout(settings));
}

export function readHidden(settings) {
    if (settings.get_string('panel-layout'))
        return new Set(settings.get_strv('panel-hidden'));
    // Ainda no formato antigo: as chaves show-* dizem o que está escondido.
    const hidden = new Set();
    for (const [key, ids] of Object.entries(LEGACY_SHOW)) {
        if (!settings.get_boolean(key))
            ids.forEach(id => hidden.add(id));
    }
    return hidden;
}

export function writeLayout(settings, layout) {
    const hidden = readHidden(settings); // antes de sair do formato antigo
    settings.set_strv('panel-hidden', [...hidden]);
    settings.set_string('panel-layout', JSON.stringify(normalize(layout)));
}

export function setHidden(settings, id, hide) {
    const layout = readLayout(settings);
    const hidden = readHidden(settings);
    if (hide)
        hidden.add(id);
    else
        hidden.delete(id);
    settings.set_strv('panel-hidden', [...hidden]);
    settings.set_string('panel-layout', JSON.stringify(layout));
}

// Onde o item está: [lado, índice do grupo, índice no grupo].
export function locate(layout, id) {
    for (const box of BOXES) {
        for (let g = 0; g < layout[box].length; g++) {
            const i = layout[box][g].indexOf(id);
            if (i >= 0)
                return [box, g, i];
        }
    }
    return null;
}

// Move um item. Os índices do destino se referem ao layout de antes da
// mudança (é o que a tela mostrava):
//   {box, type: 'new', index}           grupo novo, só com o item, na posição index
//   {box, type: 'join', group, index}   entra no grupo `group`, na posição index
export function moveItem(layout, id, target) {
    const PLACEHOLDER = null;
    const next = {};
    for (const box of BOXES)
        next[box] = layout[box].map(group => group.map(x => x === id ? PLACEHOLDER : x));

    const groups = next[target.box];
    if (target.type === 'join' && groups[target.group])
        groups[target.group].splice(Math.max(0, Math.min(target.index, groups[target.group].length)), 0, id);
    else
        groups.splice(Math.max(0, Math.min(target.index, groups.length)), 0, [id]);

    for (const box of BOXES)
        next[box] = next[box].map(group => group.filter(x => x !== PLACEHOLDER)).filter(group => group.length);
    return next;
}
