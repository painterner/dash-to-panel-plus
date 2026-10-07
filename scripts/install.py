#!/usr/bin/python3
"""Install an additive companion extension, back up settings, and request activation."""
from datetime import datetime
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile
from gi.repository import Gio
from build import build, UUID

BASE = 'dash-to-panel@jderose9.github.com'
home = Path.home()
extensions = home / '.local/share/gnome-shell/extensions'
metadata = json.loads((extensions / BASE / 'metadata.json').read_text())
if metadata['version'] != 56:
    raise SystemExit('This companion currently targets Dash to Panel v56 only.')
version = subprocess.check_output(['gnome-shell', '--version'], text=True)
if not version.split()[-1].startswith('42.'):
    raise SystemExit('This build is tested for GNOME Shell 42 only.')
archive = build()
backup = home / '.local/state/dash-to-panel-plus' / datetime.now().strftime('%Y%m%d-%H%M%S')
backup.mkdir(parents=True, mode=0o700)
shell = Gio.Settings.new('org.gnome.shell')
keys = ['enabled-extensions', 'disabled-extensions', 'favorite-apps']
(backup / 'shell.json').write_text(json.dumps({key:shell.get_strv(key) for key in keys}, indent=2))
for name in ['dash-to-panel', 'dash-to-panel-plus']:
    data = subprocess.check_output(['dconf','dump',f'/org/gnome/shell/extensions/{name}/'],text=True)
    (backup / (name + '.dconf')).write_text(data)
destination = extensions / UUID
if destination.exists(): shutil.copytree(destination, backup / 'previous-extension')
with tempfile.TemporaryDirectory(prefix='dtpp-install-', dir=extensions) as folder:
    stage = Path(folder) / UUID
    stage.mkdir()
    with zipfile.ZipFile(archive) as package: package.extractall(stage)
    if destination.exists(): shutil.rmtree(destination)
    shutil.move(stage, destination)
enabled = shell.get_strv('enabled-extensions')
disabled = shell.get_strv('disabled-extensions')
if UUID not in enabled: shell.set_strv('enabled-extensions', enabled + [UUID])
if UUID in disabled: shell.set_strv('disabled-extensions', [item for item in disabled if item != UUID])
Gio.Settings.sync()
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
from gi.repository import GLib
reply = bus.call_sync('org.gnome.Shell','/org/gnome/Shell','org.gnome.Shell.Extensions','GetExtensionInfo',GLib.Variant('(s)',(UUID,)),None,Gio.DBusCallFlags.NONE,5000,None)
info = reply.unpack()[0]
print(json.dumps({'installed':str(destination),'archive':str(archive),'backup':str(backup),'active':info.get('state') == 1,'needsLogin':not bool(info)},indent=2))
