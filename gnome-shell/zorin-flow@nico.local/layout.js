// O painel inteiro, como o editor mostra e a extensão monta. Sem nada do Shell:
// usado pela extensão e pela tela de configurações.
//
// Duas fontes, cada uma dona de uma parte:
//   - O painel do Zorin (zorin-taskbar, `panel-element-positions`) decide a
//     ordem e o lado dos elementos do sistema — menu Zorin, Atividades, apps
//     abertos, menu do sistema, data e hora — e das três caixas de applets
//     (leftBox, centerBox, rightBox).
//   - O Zorin Flow (`panel-layout`) decide o que vai dentro de cada caixa: uma
//     lista de grupos; cada grupo é uma lista de itens colados num mesmo botão.
//     Itens de outras extensões (o HD, a bandeja…) entram como `ext:<papel>`,
//     sempre sozinhos no seu grupo.
// Itens escondidos ficam em `panel-hidden`; elementos do sistema, no `visible`
// do próprio Zorin.

export const ITEMS = [
    {id: 'terminal-new', title: 'Novo terminal', short: 'Terminal', icon: 'utilities-terminal-symbolic', box: 'leftBox'},
    {id: 'terminal-dots', title: 'Bolinhas dos terminais (cor da pasta)', short: 'Bolinhas', icon: 'media-record-symbolic', box: 'leftBox'},
    {id: 'pictures', title: 'Imagens', short: 'Imagens', icon: 'folder-pictures-symbolic', box: 'leftBox'},
    {id: 'downloads', title: 'Downloads', short: 'Downloads', icon: 'folder-download-symbolic', box: 'leftBox'},
    {id: 'desktop', title: 'Mostrar área de trabalho', short: 'Área trab.', icon: 'user-desktop-symbolic', box: 'leftBox'},
    {id: 'tiling', title: 'Tiling automático', short: 'Tiling', icon: 'view-grid-symbolic', box: 'leftBox'},
    {id: 'settings', title: 'Configurações do Zorin Flow', short: 'Config.', icon: 'emblem-system-symbolic', box: 'leftBox'},
    {id: 'clipboard', title: 'Área de transferência (Super+V)', short: 'Transfer.', icon: 'edit-paste-symbolic', box: 'rightBox'},
    {id: 'vampire', title: 'Modo vampiro', short: 'Vampiro', icon: 'weather-clear-night-symbolic', box: 'rightBox'},
];

export const SYSTEM_ELEMENTS = {
    showAppsButton: {title: 'Menu Zorin', short: 'Menu', icon: 'view-app-grid-symbolic'},
    activitiesButton: {title: 'Atividades', short: 'Atividades', icon: 'focus-windows-symbolic'},
    taskbar: {title: 'Apps abertos (barra de tarefas)', short: 'Apps abertos', icon: 'view-list-bullet-symbolic'},
    systemMenu: {title: 'Menu do sistema (rede, som, desligar)', short: 'Sistema', icon: 'system-shutdown-symbolic'},
    dateMenu: {title: 'Data e hora', short: 'Data/hora', icon: 'preferences-system-time-symbolic'},
    desktopButton: {title: 'Botão "mostrar área de trabalho" do Zorin', short: 'Botão área', icon: 'user-desktop-symbolic'},
};

export const BOX_ELEMENTS = ['leftBox', 'centerBox', 'rightBox'];
// Caixa → nome usado pelo Main.panel.addToStatusArea.
export const BOX_PANEL_NAME = {leftBox: 'left', centerBox: 'center', rightBox: 'right'};

export const ZONES = ['left', 'center', 'right'];
export const ZONE_TITLES = {left: 'Esquerda', center: 'Centro', right: 'Direita'};
const ZONE_POSITION = {left: 'stackedTL', center: 'centered', right: 'stackedBR'};
const POSITION_ZONE = {stackedTL: 'left', centered: 'center', centerMonitor: 'center', stackedBR: 'right'};

export const ZORIN_TASKBAR_SCHEMA = 'org.gnome.shell.extensions.zorin-taskbar';

const DEFAULT_BOXES = {
    leftBox: [['terminal-new', 'terminal-dots'], ['pictures', 'downloads', 'desktop'], ['tiling'], ['settings']],
    centerBox: [],
    rightBox: [['clipboard'], ['vampire']],
};

// Formatos antigos do Zorin Flow.
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

const ours = new Set(ITEMS.map(i => i.id));
// O GJS do GNOME 46 não tem structuredClone; tudo aqui é JSON puro.
const clone = value => JSON.parse(JSON.stringify(value));
export const isExternal = id => id.startsWith('ext:');
export const isBox = el => BOX_ELEMENTS.includes(el);

// --- o que vai dentro das caixas ------------------------------------------

function legacyBoxes(settings) {
    const boxes = {};
    let any = false;
    for (const box of BOX_ELEMENTS) {
        const roles = settings.get_strv(`panel-${BOX_PANEL_NAME[box]}`);
        any ||= roles.length > 0;
        boxes[box] = roles.map(r => LEGACY_GROUPS[r] ? [...LEGACY_GROUPS[r]] : [r]);
    }
    return any ? boxes : clone(DEFAULT_BOXES);
}

function normalizeBoxes(raw) {
    const boxes = {};
    const seen = new Set();
    for (const box of BOX_ELEMENTS) {
        boxes[box] = (Array.isArray(raw?.[box]) ? raw[box] : [])
            .map(group => (Array.isArray(group) ? group : []).filter(id => {
                if (typeof id !== 'string' || seen.has(id) || !(ours.has(id) || isExternal(id)))
                    return false;
                seen.add(id);
                return true;
            }))
            // Item de outra extensão nunca divide grupo (é outro botão do painel).
            .flatMap(group => {
                const ext = group.filter(isExternal);
                const mine = group.filter(id => !isExternal(id));
                return [...(mine.length ? [mine] : []), ...ext.map(id => [id])];
            });
    }
    for (const item of ITEMS) {
        if (!seen.has(item.id))
            boxes[item.box].push([item.id]);
    }
    return boxes;
}

export function readBoxes(settings) {
    const json = settings.get_string('panel-layout');
    if (json) {
        try {
            const raw = JSON.parse(json);
            if (raw?.version === 2)
                return normalizeBoxes(raw.boxes);
            // Versão 1: {left, center, right} de grupos → uma caixa por lado.
            return normalizeBoxes({leftBox: raw.left, centerBox: raw.center, rightBox: raw.right});
        } catch {
            // JSON estragado: volta ao padrão abaixo.
        }
    }
    return normalizeBoxes(legacyBoxes(settings));
}

export function readHidden(settings) {
    if (settings.get_string('panel-layout'))
        return new Set(settings.get_strv('panel-hidden'));
    const hidden = new Set();
    for (const [key, ids] of Object.entries(LEGACY_SHOW)) {
        if (!settings.get_boolean(key))
            ids.forEach(id => hidden.add(id));
    }
    return hidden;
}

export function writeBoxes(settings, boxes) {
    const hidden = readHidden(settings); // antes de sair do formato antigo
    settings.set_strv('panel-hidden', [...hidden]);
    settings.set_string('panel-layout', JSON.stringify({version: 2, boxes: normalizeBoxes(boxes)}));
}

export function setHidden(settings, id, hide) {
    const boxes = readBoxes(settings);
    const hidden = readHidden(settings);
    if (hide)
        hidden.add(id);
    else
        hidden.delete(id);
    settings.set_strv('panel-hidden', [...hidden]);
    settings.set_string('panel-layout', JSON.stringify({version: 2, boxes}));
}

// Itens de outras extensões que a extensão encontrou no painel
// (`panel-foreign`): [{role, title, icon, box}].
export function readForeign(settings) {
    try {
        const list = JSON.parse(settings.get_string('panel-foreign') || '[]');
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

// Caixas com os itens de fora que ainda não estão no layout (no fim da caixa
// em que estão hoje) e sem os que sumiram (extensão desligada).
export function withForeign(boxes, foreign) {
    const present = new Set(foreign.map(f => `ext:${f.role}`));
    const out = {};
    const seen = new Set();
    for (const box of BOX_ELEMENTS) {
        out[box] = boxes[box].filter(g => !isExternal(g[0]) || present.has(g[0]));
        out[box].forEach(g => g.forEach(id => seen.add(id)));
    }
    for (const f of foreign) {
        const id = `ext:${f.role}`;
        if (!seen.has(id))
            out[BOX_ELEMENTS.includes(f.box) ? f.box : 'rightBox'].push([id]);
    }
    return out;
}

// --- ordem dos elementos (painel do Zorin) --------------------------------

function monitorKey(positions) {
    const keys = Object.keys(positions);
    // O Zorin prefere a chave com o número de série do monitor.
    return keys.find(k => !/^\d+$/.test(k)) ?? keys[0];
}

export function readElements(taskbarSettings) {
    if (!taskbarSettings) {
        return {
            zones: {left: ['leftBox'], center: ['centerBox'], right: ['rightBox']},
            visible: {},
        };
    }
    let positions = {};
    try {
        positions = JSON.parse(taskbarSettings.get_string('panel-element-positions') || '{}');
    } catch {}
    const list = positions[monitorKey(positions)] ?? [];
    const zones = {left: [], center: [], right: []};
    const visible = {};
    for (const e of list) {
        zones[POSITION_ZONE[e.position] ?? 'left'].push(e.element);
        visible[e.element] = e.visible !== false;
    }
    // Caixas que faltarem (configuração vazia): no lado de sempre.
    for (const box of BOX_ELEMENTS) {
        if (!Object.values(zones).some(z => z.includes(box))) {
            zones[{leftBox: 'left', centerBox: 'center', rightBox: 'right'}[box]].push(box);
            visible[box] = true;
        }
    }
    return {zones, visible};
}

export function writeElements(taskbarSettings, zones, visible) {
    if (!taskbarSettings)
        return;
    let positions = {};
    try {
        positions = JSON.parse(taskbarSettings.get_string('panel-element-positions') || '{}');
    } catch {}
    const list = ZONES.flatMap(zone => zones[zone].map(element => ({
        element,
        // As caixas ficam sempre visíveis; o que some é o que vai dentro delas.
        visible: isBox(element) ? true : visible[element] !== false,
        position: ZONE_POSITION[zone],
    })));
    const keys = Object.keys(positions);
    for (const key of keys.length ? keys : ['0'])
        positions[key] = list;
    taskbarSettings.set_string('panel-element-positions', JSON.stringify(positions));
}

// --- o painel achatado, como o editor mostra --------------------------------
//
// Por lado, uma sequência de peças: {kind: 'el', el} para elementos do
// sistema e {kind: 'group', box, gi, ids} para cada grupo dentro de uma caixa.
// Caixas vazias não aparecem (mas continuam no lugar delas).

export function flatten(state) {
    const tokens = {};
    for (const zone of ZONES) {
        tokens[zone] = [];
        for (const el of state.zones[zone]) {
            if (isBox(el))
                state.boxes[el].forEach((ids, gi) => tokens[zone].push({kind: 'group', box: el, gi, ids}));
            else
                tokens[zone].push({kind: 'el', el});
        }
    }
    return tokens;
}

function cloneState(state) {
    return {
        zones: clone(state.zones),
        visible: {...state.visible},
        boxes: clone(state.boxes),
    };
}

function cleanBoxes(boxes) {
    for (const box of BOX_ELEMENTS)
        boxes[box] = boxes[box].map(g => g.filter(x => x !== null)).filter(g => g.length);
}

export function locateItem(state, id) {
    for (const box of BOX_ELEMENTS) {
        const gi = state.boxes[box].findIndex(g => g.includes(id));
        if (gi >= 0)
            return {box, gi, index: state.boxes[box][gi].indexOf(id)};
    }
    return null;
}

export function zoneOf(state, el) {
    return ZONES.find(z => state.zones[z].includes(el));
}

// Entra no grupo `gi` da caixa `box`, na posição `index` (só itens nossos).
export function joinGroup(state, id, box, gi, index) {
    const target = state.boxes[box][gi];
    if (!target || isExternal(id) || isExternal(target[0]))
        return null;
    const s = cloneState(state);
    for (const b of BOX_ELEMENTS)
        s.boxes[b] = s.boxes[b].map(g => g.map(x => x === id ? null : x));
    s.boxes[box][gi].splice(Math.max(0, Math.min(index, target.length)), 0, id);
    cleanBoxes(s.boxes);
    return s;
}

// Solta um item no espaço entre as peças `left` e `right` de um lado (null =
// começo/fim). Encostado num grupo: vira um grupo novo naquela caixa. Entre
// elementos do sistema: usa uma caixa vazia, que vai para ali. Sem caixa
// vazia (as três em uso), não dá: devolve null.
export function dropItem(state, id, zone, left, right) {
    const s = cloneState(state);
    for (const b of BOX_ELEMENTS)
        s.boxes[b] = s.boxes[b].map(g => g.map(x => x === id ? null : x));

    if (left?.kind === 'group') {
        s.boxes[left.box].splice(left.gi + 1, 0, [id]);
    } else if (right?.kind === 'group') {
        s.boxes[right.box].splice(right.gi, 0, [id]);
    } else {
        const empty = BOX_ELEMENTS.find(b => s.boxes[b].every(g => g.every(x => x === null)));
        if (!empty)
            return null;
        for (const z of ZONES)
            s.zones[z] = s.zones[z].filter(e => e !== empty);
        const list = s.zones[zone];
        const at = left ? list.indexOf(left.el) + 1 : right ? list.indexOf(right.el) : list.length;
        list.splice(at, 0, empty);
        s.boxes[empty].push([id]);
    }
    cleanBoxes(s.boxes);
    return s;
}

// Solta um elemento do sistema no espaço entre `left` e `right`. Não pode
// cair no meio de uma caixa (entre dois grupos da mesma caixa).
export function dropElement(state, el, zone, left, right) {
    if (left?.kind === 'group' && right?.kind === 'group' && left.box === right.box)
        return null;
    const anchorAfter = left ? (left.kind === 'group' ? left.box : left.el) : null;
    const anchorBefore = right ? (right.kind === 'group' ? right.box : right.el) : null;
    if (anchorAfter === el || anchorBefore === el)
        return state; // já está aí
    const s = cloneState(state);
    for (const z of ZONES)
        s.zones[z] = s.zones[z].filter(e => e !== el);
    const list = s.zones[zone];
    const at = anchorAfter ? list.indexOf(anchorAfter) + 1 : anchorBefore ? list.indexOf(anchorBefore) : list.length;
    list.splice(at, 0, el);
    return s;
}
