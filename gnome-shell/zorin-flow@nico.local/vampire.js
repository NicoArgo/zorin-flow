// Modo vampiro: o PC só dorme quando você manda.
//
// Enquanto ativo, segura um inibidor de suspensão no GNOME Session (que por sua
// vez bloqueia a suspensão no logind): nada de dormir por inatividade nem ao
// fechar a tampa. A tela ainda pode apagar normalmente. 1 h, 3 h ou até
// desligar; o prazo fica salvo e sobrevive a reiniciar o Shell.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {MenuPanelItem} from './item.js';

const INHIBIT_SUSPEND = 4;

const SessionManagerIface = `<node>
  <interface name="org.gnome.SessionManager">
    <method name="Inhibit">
      <arg type="s" direction="in"/><arg type="u" direction="in"/>
      <arg type="s" direction="in"/><arg type="u" direction="in"/>
      <arg type="u" direction="out"/>
    </method>
    <method name="Uninhibit"><arg type="u" direction="in"/></method>
  </interface>
</node>`;
const SessionManagerProxy = Gio.DBusProxy.makeProxyWrapper(SessionManagerIface);

const UPowerIface = `<node>
  <interface name="org.freedesktop.UPower">
    <property name="LidIsClosed" type="b" access="read"/>
    <property name="LidIsPresent" type="b" access="read"/>
  </interface>
</node>`;
const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPowerIface);

const MODES = [
    {label: 'Desligado', seconds: 0},
    {label: '1 hora', seconds: 3600},
    {label: '3 horas', seconds: 3 * 3600},
    {label: 'Até eu desligar', seconds: -1},
];

function now() {
    return Math.floor(GLib.get_real_time() / 1e6);
}

function formatLeft(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.ceil((secs % 3600) / 60);
    if (m === 60)
        return `${h + 1} h`;
    return h ? `${h} h ${m} min` : `${m} min`;
}

export class VampireItem extends MenuPanelItem {
    constructor(settings) {
        super('Modo vampiro');
        this._settings = settings;
        this._cookie = null;
        this._inhibiting = false;

        this._icon = new St.Icon({icon_name: 'weather-clear-night-symbolic', style_class: 'system-status-icon'});
        this.button.set_child(this._icon);

        this._status = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._status);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Modo vampiro'));
        this._items = MODES.map(mode => {
            const item = new PopupMenu.PopupMenuItem(mode.label);
            item.connect('activate', () => this._setMode(mode.seconds));
            this.menu.addMenuItem(item);
            return {mode, item};
        });
        this.menu.connect('open-state-changed', (_m, open) => open && this._sync());

        this._sm = new SessionManagerProxy(Gio.DBus.session, 'org.gnome.SessionManager',
            '/org/gnome/SessionManager', (_p, error) => {
                if (error)
                    logError(error, 'zorin-flow: SessionManager');
                if (this._destroyed)
                    return;
                this._smReady = !error;
                this._sync();
            });

        this._upower = new UPowerProxy(Gio.DBus.system, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower', (proxy, error) => {
                if (error || this._destroyed || !proxy.LidIsPresent)
                    return;
                this._lidId = proxy.connect('g-properties-changed', () => {
                    if (proxy.LidIsClosed && this._active())
                        Main.notify('Modo vampiro ativo', 'Tampa fechada — o PC continua acordado.');
                });
            });

        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._sync();
            return GLib.SOURCE_CONTINUE;
        });
        this._settingsId = settings.connect('changed::vampire-until', () => this._sync());

        this._sync();
    }

    _until() {
        return this._settings.get_int64('vampire-until');
    }

    _active() {
        const until = this._until();
        return until === -1 || until > now();
    }

    _setMode(seconds) {
        if (seconds > 0)
            this._lastTimed = seconds;
        this._settings.set_int64('vampire-until', seconds <= 0 ? seconds : now() + seconds);
    }

    async _inhibit(on) {
        if (on === this._inhibiting)
            return;
        this._inhibiting = on;
        try {
            if (on) {
                const [cookie] = await this._sm.InhibitAsync('zorin-flow', 0,
                    'Modo vampiro: o PC só dorme quando você manda', INHIBIT_SUSPEND);
                if (this._inhibiting)
                    this._cookie = cookie;
                else
                    await this._sm.UninhibitAsync(cookie);
            } else if (this._cookie !== null) {
                const cookie = this._cookie;
                this._cookie = null;
                await this._sm.UninhibitAsync(cookie);
            }
        } catch (e) {
            logError(e, 'zorin-flow: inibir suspensão');
        }
    }

    _sync() {
        const until = this._until();
        if (until > 0 && until <= now()) {
            this._settings.set_int64('vampire-until', 0); // dispara outro _sync
            Main.notify('Modo vampiro', 'Acabou o tempo: o PC volta a seguir as configurações de energia.');
            return;
        }
        const active = this._active();
        if (this._smReady)
            this._inhibit(active);

        if (active)
            this._icon.add_style_class_name('zf-vampire-on');
        else
            this._icon.remove_style_class_name('zf-vampire-on');

        this._status.label.text = !active
            ? 'O PC segue as configurações de energia'
            : until === -1 ? 'Acordado até você desligar'
                : `Acordado por mais ${formatLeft(until - now())}`;
        // Prazo com hora marcada: marca a opção escolhida nesta sessão do Shell.
        const chosen = !active ? 0 : until === -1 ? -1 : this._lastTimed;
        for (const {mode, item} of this._items)
            item.setOrnament(mode.seconds === chosen ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
    }

    _onDestroy() {
        this._destroyed = true;
        GLib.source_remove(this._tickId);
        this._settings.disconnect(this._settingsId);
        if (this._lidId)
            this._upower.disconnect(this._lidId);
        this._inhibit(false);
    }
}
