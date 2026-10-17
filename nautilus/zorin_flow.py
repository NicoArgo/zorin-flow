# Zorin Flow — extensão do Nautilus.
#
# Botão direito:
#   - "Regra da pasta…" (numa pasta, ou no fundo da pasta aberta) abre o diálogo
#     do zflow-rule: nome + cor; a pasta passa a aparecer na cor da regra aqui,
#     na área de trabalho, no terminal e no applet de terminais.
#   - "Copiar caminho" (arquivos selecionados ou a pasta aberta).
#
# O diálogo roda num processo à parte: um erro nele nunca derruba o Nautilus.

import os
import shutil
import subprocess
from urllib.parse import unquote, urlparse

from gi.repository import GObject, Nautilus

ZFLOW_RULE = shutil.which("zflow-rule") or os.path.expanduser("~/.local/bin/zflow-rule")


def _local_path(file_info):
    if file_info.get_uri_scheme() != "file":
        return None
    loc = file_info.get_location()
    if loc is not None and loc.get_path():
        return loc.get_path()
    return unquote(urlparse(file_info.get_uri()).path)


def _copy_to_clipboard(text):
    from gi.repository import Gdk

    display = Gdk.Display.get_default()
    if display is None:
        return
    value = GObject.Value(GObject.TYPE_STRING, text)
    display.get_clipboard().set_content(Gdk.ContentProvider.new_for_value(value))


def _edit_rule(path):
    subprocess.Popen([ZFLOW_RULE, "edit", path], start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class ZorinFlowMenu(GObject.GObject, Nautilus.MenuProvider):

    def _rule_item(self, name, path):
        item = Nautilus.MenuItem(name=name, label="Regra da pasta…",
                                 tip="Nome e cor desta pasta (terminal, arquivos e painel)")
        item.connect("activate", lambda *_: _edit_rule(path))
        return item

    def _copy_item(self, name, paths):
        label = "Copiar caminho" if len(paths) == 1 else "Copiar caminhos"
        item = Nautilus.MenuItem(name=name, label=label)
        item.connect("activate", lambda *_: _copy_to_clipboard("\n".join(paths)))
        return item

    def get_file_items(self, files):
        paths = [_local_path(f) for f in files]
        if not paths or any(p is None for p in paths):
            return []
        items = []
        if len(files) == 1 and files[0].is_directory():
            items.append(self._rule_item("ZorinFlow::rule_file", paths[0]))
        items.append(self._copy_item("ZorinFlow::copy_file", paths))
        return items

    def get_background_items(self, folder):
        path = _local_path(folder)
        if path is None:
            return []
        return [self._rule_item("ZorinFlow::rule_bg", path),
                self._copy_item("ZorinFlow::copy_bg", [path])]
