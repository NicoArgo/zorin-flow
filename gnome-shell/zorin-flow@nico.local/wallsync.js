// Tema que segue o papel de parede: quando o papel de parede muda, roda o
// zflow-wallsync, que escolhe a cor de destaque do Zorin mais próxima da cor
// dominante da imagem (mantendo claro/escuro como está).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SCRIPT = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'zflow-wallsync']);

export class WallSync {
    constructor(settings) {
        this._settings = settings;
        this._bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._bgIds = ['picture-uri', 'picture-uri-dark'].map(key =>
            this._bg.connect(`changed::${key}`, () => this._queue()));
        this._toggleId = settings.connect('changed::wallsync', () => this._queue());
    }

    _queue() {
        if (!this._settings.get_boolean('wallsync'))
            return;
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        // Uma troca de papel de parede costuma mexer nas duas chaves.
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            this._timeoutId = 0;
            this._run();
            return GLib.SOURCE_REMOVE;
        });
    }

    _run() {
        if (!GLib.file_test(SCRIPT, GLib.FileTest.IS_EXECUTABLE))
            return;
        try {
            Gio.Subprocess.new([SCRIPT], Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, 'zorin-flow: wallsync');
        }
    }

    destroy() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        for (const id of this._bgIds)
            this._bg.disconnect(id);
        this._settings.disconnect(this._toggleId);
        this._bg = null;
    }
}
