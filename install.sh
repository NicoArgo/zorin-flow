#!/usr/bin/env bash
# Zorin Flow — instala tudo na sua home. Sem sudo, nada em /usr é tocado, então
# atualizações do sistema não desfazem nada. Rodar de novo é seguro.
# Desfazer: ./uninstall.sh
set -euo pipefail
cd "$(dirname "$(realpath "$0")")"
ROOT=$PWD

UUID=zorin-flow@nico.local
EXT_SRC="$ROOT/gnome-shell/$UUID"
EXT_DST="$HOME/.local/share/gnome-shell/extensions/$UUID"
NAUTILUS_DST="$HOME/.local/share/nautilus-python/extensions"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/zorin-flow"
BASHRC="$HOME/.bashrc"
MARK_BEGIN="# >>> zorin-flow >>>"
MARK_END="# <<< zorin-flow <<<"

say() { printf '==> %s\n' "$*"; }

# --- dependências (todas já vêm no Zorin 18; só confere) -------------------
missing=()
python3 -c 'import PIL' 2>/dev/null || missing+=(python3-pil)
python3 -c 'import gi; gi.require_version("Adw", "1")' 2>/dev/null || missing+=(gir1.2-adw-1)
dpkg-query -W -f='${Status}' python3-nautilus 2>/dev/null | grep -q 'ok installed' || missing+=(python3-nautilus)
if ((${#missing[@]})); then
    echo "Faltam pacotes: ${missing[*]}"
    echo "  sudo apt install ${missing[*]}"
    exit 1
fi

link() { # link ORIGEM DESTINO — não pisa num arquivo de verdade que já exista
    local src=$1 dst=$2
    mkdir -p "$(dirname "$dst")"
    if [[ -e $dst && ! -L $dst ]]; then
        echo "!! $dst já existe e não é um link do Zorin Flow; pulando"
        return
    fi
    ln -sfn "$src" "$dst"
}

say "Comandos zflow-* em ~/.local/bin"
chmod +x "$ROOT"/bin/*
link "$ROOT/bin/zflow-rule" "$HOME/.local/bin/zflow-rule"
link "$ROOT/bin/zflow-wallsync" "$HOME/.local/bin/zflow-wallsync"
link "$ROOT/bin/zflow-tiling-keys" "$HOME/.local/bin/zflow-tiling-keys"

say "Regras por pasta (~/.config/zorin-flow/dir_rules.json)"
"$ROOT/bin/zflow-rule" sync

say "Terminal: hook no ~/.bashrc"
if ! grep -qF "$MARK_BEGIN" "$BASHRC" 2>/dev/null; then
    cp "$BASHRC" "$BASHRC.zorin-flow.bak" 2>/dev/null || true
    {
        echo ""
        echo "$MARK_BEGIN"
        echo "# identidade por pasta no terminal (cor, nome, applet do painel)"
        echo "[ -f \"$ROOT/shell/zflow.bash\" ] && . \"$ROOT/shell/zflow.bash\""
        echo "$MARK_END"
    } >> "$BASHRC"
else
    echo "   (já estava)"
fi

say "Arquivos (Nautilus): Regra da pasta… e Copiar caminho"
link "$ROOT/nautilus/zorin_flow.py" "$NAUTILUS_DST/zorin_flow.py"

say "Extensão do GNOME Shell"
glib-compile-schemas "$EXT_SRC/schemas"
link "$EXT_SRC" "$EXT_DST"
enabled=$(gsettings get org.gnome.shell enabled-extensions)
if [[ $enabled != *"'$UUID'"* ]]; then
    python3 - "$UUID" <<'EOF'
import sys
from gi.repository import Gio
s = Gio.Settings.new("org.gnome.shell")
uuid = sys.argv[1]
s.set_strv("enabled-extensions", s.get_strv("enabled-extensions") + [uuid])
s.set_strv("disabled-extensions", [u for u in s.get_strv("disabled-extensions") if u != uuid])
Gio.Settings.sync()
EOF
fi

say "Super+V para o histórico"
# O GNOME usa Super+V e Super+M para a lista de notificações. Tiramos só o
# Super+V dela (Super+M continua) e guardamos o valor original.
mkdir -p "$CONFIG"
tray=$(gsettings get org.gnome.shell.keybindings toggle-message-tray)
if [[ $tray == *"'<Super>v'"* ]]; then
    [[ -f $CONFIG/backup-toggle-message-tray ]] || echo "$tray" > "$CONFIG/backup-toggle-message-tray"
    python3 - <<'EOF'
from gi.repository import Gio
s = Gio.Settings.new("org.gnome.shell.keybindings")
s.set_strv("toggle-message-tray", [k for k in s.get_strv("toggle-message-tray") if k.lower() != "<super>v"])
Gio.Settings.sync()
EOF
    echo "   Super+V liberado (notificações continuam no Super+M)"
fi

say "Tiling: atalhos do Pop (Super+setas foco, Super+Shift+setas move)"
if gsettings list-schemas | grep -qx org.gnome.shell.extensions.zorin-tiling-shell; then
    "$ROOT/bin/zflow-tiling-keys" apply
else
    echo "   Zorin Tiling Shell não encontrado; pulando"
fi

cat <<EOF

Pronto. Para ativar:
  1. Shell:    Alt+F2, digite  r  e Enter   (recarrega o painel; janelas ficam abertas)
  2. Arquivos: nautilus -q                 (fecha as janelas do Arquivos; reabra depois)
  3. Terminal: abra um terminal novo

Regra de pasta: botão direito numa pasta → "Regra da pasta…"
            ou: zflow-rule set . --name "Meu projeto" --color "#2ec4d6"
Configurações: gnome-extensions prefs $UUID
EOF
