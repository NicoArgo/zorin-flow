"""Zorin Flow — regras por pasta (fonte única).

Uma regra dá a uma pasta um nome e uma cor. O terminal (hook de bash), o
Nautilus e o applet de terminais leem a mesma lista — uma pasta tem uma cor e
um lugar para trocá-la.

Modelo (o mesmo do POP Flow): uma regra vale só para a própria pasta; cobrir a
árvore embaixo dela é opt-in (`include_subdirs`). A comparação é por componente
de caminho (`/a/bc` não casa com a regra `/a/b`) e, quando duas regras alcançam
o mesmo diretório, vence a mais específica.

Arquivos:
  ~/.config/zorin-flow/dir_rules.json   as regras (editável à mão; rode `zflow-rule sync` depois)
  ~/.cache/zorin-flow/dir_rules.tsv     cópia achatada para o hook de bash (gerada)
  ~/.local/share/zorin-flow/icons/      ícones de pasta coloridos (gerados)
"""

import colorsys
import json
import os
import re
import subprocess
import tempfile
from dataclasses import asdict, dataclass

HOME = os.path.expanduser("~")
CONFIG_DIR = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.join(HOME, ".config"), "zorin-flow")
CACHE_DIR = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.join(HOME, ".cache"), "zorin-flow")
DATA_DIR = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(HOME, ".local", "share"), "zorin-flow")
RULES_FILE = os.path.join(CONFIG_DIR, "dir_rules.json")
TSV_FILE = os.path.join(CACHE_DIR, "dir_rules.tsv")
ICON_DIR = os.path.join(DATA_DIR, "icons")

FOLDER_ICON_THEMES = ["ZorinPurple-Dark", "ZorinBlue-Dark", "Zorin", "Adwaita"]

# Cores rápidas do diálogo (as mesmas oito do acento do Zorin + algumas vivas).
PALETTE = [
    "#3584e4", "#2ec4d6", "#26a269", "#9ac43c", "#f6d32d", "#ff7800",
    "#e01b24", "#e9639a", "#9141ac", "#865e3c", "#77767b", "#ffffff",
]

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


@dataclass
class Rule:
    path: str
    name: str = ""
    accent: str = ""
    include_subdirs: bool = False
    enabled: bool = True


def normalize(path):
    """Caminho absoluto *lógico* (sem resolver links) — o mesmo que o $PWD do bash."""
    path = os.path.abspath(os.path.expanduser(path))
    return path.rstrip("/") or "/"


def valid_color(color):
    return bool(_HEX.match(color or ""))


def load():
    try:
        with open(RULES_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return []
    rules = []
    for r in data.get("rules", []):
        if not isinstance(r, dict) or not r.get("path"):
            continue
        rules.append(Rule(
            path=normalize(r["path"]),
            name=str(r.get("name", "")),
            accent=r.get("accent", "") if valid_color(r.get("accent", "")) else "",
            include_subdirs=bool(r.get("include_subdirs", False)),
            enabled=bool(r.get("enabled", True)),
        ))
    return rules


def _atomic_write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def save(rules):
    rules = sorted(rules, key=lambda r: r.path)
    _atomic_write(RULES_FILE, json.dumps({"rules": [asdict(r) for r in rules]}, indent=2, ensure_ascii=False) + "\n")
    write_tsv(rules)


def write_tsv(rules):
    """Uma linha por regra ativa: caminho, subpastas (0/1), nome, cor."""
    lines = []
    for r in rules:
        if not r.enabled or "\t" in r.path or "\n" in r.path:
            continue
        name = r.name.replace("\t", " ").replace("\n", " ")
        lines.append(f"{r.path}\t{int(r.include_subdirs)}\t{name}\t{r.accent}\n")
    _atomic_write(TSV_FILE, "".join(lines))


def find(rules, path):
    path = normalize(path)
    return next((r for r in rules if r.path == path), None)


def match(rules, path):
    """A regra que vale para `path`: a da própria pasta, senão a árvore mais funda."""
    path = normalize(path)
    best = None
    for r in rules:
        if not r.enabled:
            continue
        if r.path == path:
            return r
        prefix = r.path if r.path == "/" else r.path + "/"
        if r.include_subdirs and path.startswith(prefix):
            if best is None or len(r.path) > len(best.path):
                best = r
    return best


# --- ícone de pasta na cor da regra ---------------------------------------

def _hex_to_rgb(color):
    return tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))


def _base_folder_png():
    for theme in FOLDER_ICON_THEMES:
        for size in ("512x512", "256x256", "128x128", "48x48@2x"):
            p = f"/usr/share/icons/{theme}/{size}/places/folder.png"
            if os.path.exists(p):
                return p
    return None


def icon_path(color):
    return os.path.join(ICON_DIR, f"folder-{color.lstrip('#').lower()}.png")


def make_icon(color):
    """Recolore o ícone de pasta do tema: a aba fica na cor da regra e a frente
    num tom mais claro dela. Sombras (cinzas) ficam como estão."""
    out = icon_path(color)
    if os.path.exists(out):
        return out
    base = _base_folder_png()
    if base is None:
        return None
    from PIL import Image

    im = Image.open(base).convert("RGBA").resize((256, 256), Image.LANCZOS)
    w, h = im.size
    px = im.load()

    def light(rgb):
        return colorsys.rgb_to_hls(*(c / 255 for c in rgb))[1]

    # Os dois tons do ícone: a aba (mais escura) e a frente (mais clara).
    back_l = light(px[int(w * 0.2), int(h * 0.2)][:3])
    front_l = light(px[int(w * 0.6), int(h * 0.6)][:3])
    if abs(front_l - back_l) < 0.02:
        back_l, front_l = front_l - 0.1, front_l

    accent = _hex_to_rgb(color)
    h_a, l_a, s_a = colorsys.rgb_to_hls(*(c / 255 for c in accent))
    dark = accent
    lite = tuple(round(c + (255 - c) * 0.35) for c in accent)

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            _, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if s < 0.12:  # sombra / contorno neutro
                continue
            t = max(-0.6, min(1.6, (l - back_l) / (front_l - back_l)))
            c = [max(0, min(255, round(dark[i] + (lite[i] - dark[i]) * t))) for i in range(3)]
            px[x, y] = (c[0], c[1], c[2], a)

    os.makedirs(ICON_DIR, exist_ok=True)
    im.save(out)
    return out


def _gio_get_custom_icon(path):
    try:
        out = subprocess.run(["gio", "info", "-a", "metadata::custom-icon", path],
                             capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"metadata::custom-icon:\s*(\S+)", out)
    return m.group(1) if m else None


def _ours(uri):
    return bool(uri) and ICON_DIR in uri


def _poke(path):
    """Avisa quem observa a pasta (Nautilus, ícones da área de trabalho) para
    reler o ícone. Gravar metadados do gvfs não gera evento no inotify; um
    chmod para a mesma permissão gera (IN_ATTRIB) sem mudar nada na pasta —
    nem a data de modificação."""
    try:
        os.chmod(path, os.stat(path).st_mode & 0o7777)
    except OSError:
        pass


def apply_icon(rule):
    if not os.path.isdir(rule.path):
        return
    if not rule.enabled or not rule.accent:
        clear_icon(rule.path)
        return
    current = _gio_get_custom_icon(rule.path)
    if current and not _ours(current):
        return  # ícone escolhido à mão: não pisar
    icon = make_icon(rule.accent)
    if icon:
        subprocess.run(["gio", "set", rule.path, "metadata::custom-icon", "file://" + icon],
                       capture_output=True, timeout=5)
        _poke(rule.path)


def clear_icon(path):
    if os.path.exists(path) and _ours(_gio_get_custom_icon(path)):
        subprocess.run(["gio", "set", "-t", "unset", path, "metadata::custom-icon"],
                       capture_output=True, timeout=5)
        _poke(path)


# --- operações de alto nível (usadas pela CLI e pelo diálogo) --------------

def set_rule(path, name=None, accent=None, include_subdirs=None, enabled=None):
    path = normalize(path)
    if accent is not None and accent != "" and not valid_color(accent):
        raise ValueError(f"cor inválida: {accent!r} (use #rrggbb)")
    rules = load()
    rule = find(rules, path)
    if rule is None:
        rule = Rule(path=path)
        rules.append(rule)
    if name is not None:
        rule.name = name
    if accent is not None:
        rule.accent = accent.lower()
    if include_subdirs is not None:
        rule.include_subdirs = include_subdirs
    if enabled is not None:
        rule.enabled = enabled
    save(rules)
    apply_icon(rule)
    return rule


def remove_rule(path):
    path = normalize(path)
    rules = load()
    rule = find(rules, path)
    if rule is None:
        return False
    rules.remove(rule)
    save(rules)
    clear_icon(path)
    return True


def sync():
    """Regera o TSV e os ícones a partir do JSON (depois de editar à mão)."""
    rules = load()
    write_tsv(rules)
    for r in rules:
        apply_icon(r)
    return rules
