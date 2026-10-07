#!/usr/bin/python3
"""Disable only the companion extension; the base Dash to Panel is kept enabled."""
from gi.repository import Gio
UUID = 'dash-to-panel-plus@ka.local'
settings = Gio.Settings.new('org.gnome.shell')
settings.set_strv('enabled-extensions', [item for item in settings.get_strv('enabled-extensions') if item != UUID])
disabled = settings.get_strv('disabled-extensions')
if UUID not in disabled: settings.set_strv('disabled-extensions', disabled + [UUID])
Gio.Settings.sync()
print('Dash to Panel Plus disabled; the original taskbar and favorites are preserved.')
