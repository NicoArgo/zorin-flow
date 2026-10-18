#!/usr/bin/env bash
# Zorin Flow — desfaz o install.sh. Suas regras (~/.config/zorin-flow) ficam
# guardadas; use --purge para apagá-las também.
set -euo pipefail
cd "$(dirname "$(realpath "$0")")"
ROOT=$PWD

UUID=zorin-flow@nico.local
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/zorin-flow"
BASHRC="$HOME/.bashrc"

say() { printf '==> %s\n' "$*"; }

unlink_ours() { # remove o link só se ele aponta para este projeto
    local dst=$1
    if [[ -L $dst && $(readlink -f "$dst") == "$ROOT"/* ]]; then
        rm -f "$dst"
    fi
}

say "Tirando as cores das pastas"
python3 - "$ROOT/lib" <<'EOF'
import sys
sys.path.insert(0, sys.argv[1])
import zflow_rules as zr
for r in zr.load():
    zr.clear_icon(r.path)
EOF

say "Extensão do GNOME Shell"
python3 - "$UUID" <<'EOF'
import sys
from gi.repository import Gio
s = Gio.Settings.new("org.gnome.shell")
s.set_strv("enabled-extensions", [u for u in s.get_strv("enabled-extensions") if u != sys.argv[1]])
Gio.Settings.sync()
EOF
unlink_ours "$HOME/.local/share/gnome-shell/extensions/$UUID"

say "Super+V de volta para as notificações"
if [[ -f $CONFIG/backup-toggle-message-tray ]]; then
    gsettings set org.gnome.shell.keybindings toggle-message-tray "$(cat "$CONFIG/backup-toggle-message-tray")"
    rm -f "$CONFIG/backup-toggle-message-tray"
fi

say "Atalhos de tiling de volta"
"$ROOT/bin/zflow-tiling-keys" restore || true

say "Arquivos (Nautilus)"
unlink_ours "$HOME/.local/share/nautilus-python/extensions/zorin_flow.py"

say "Terminal: tirando o hook do ~/.bashrc"
if grep -qF "# >>> zorin-flow >>>" "$BASHRC" 2>/dev/null; then
    sed -i '/^# >>> zorin-flow >>>$/,/^# <<< zorin-flow <<<$/d' "$BASHRC"
    # a linha em branco que o install.sh pôs antes do bloco
    sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$BASHRC"
fi

say "Comandos"
unlink_ours "$HOME/.local/bin/zflow-rule"
unlink_ours "$HOME/.local/bin/zflow-wallsync"
unlink_ours "$HOME/.local/bin/zflow-tiling-keys"

rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/zorin-flow" "${XDG_DATA_HOME:-$HOME/.local/share}/zorin-flow"
if [[ ${1-} == --purge ]]; then
    rm -rf "$CONFIG"
    echo "   regras apagadas"
fi

echo
echo "Desinstalado. Alt+F2 → r para recarregar o painel; nautilus -q; terminais novos."
