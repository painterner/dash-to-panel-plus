#!/usr/bin/python3
"""Run a real GNOME Shell in a separate D-Bus session, runtime dir and dconf home."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time

root = Path(__file__).resolve().parents[1]
output = root / 'test-output'
output.mkdir(exist_ok=True)
(output / 'result.json').unlink(missing_ok=True)
(output / 'argv.json').unlink(missing_ok=True)
with tempfile.TemporaryDirectory(prefix='dtpp-gnome-test-', ignore_cleanup_errors=True) as folder:
    tmp = Path(folder)
    extensions = tmp / 'data/gnome-shell/extensions'
    extensions.mkdir(parents=True)
    shutil.copytree(Path.home() / '.local/share/gnome-shell/extensions/dash-to-panel@jderose9.github.com', extensions / 'dash-to-panel@jderose9.github.com')
    shutil.copytree(root / 'extension', extensions / 'dash-to-panel-plus@ka.local')
    test_extension = extensions / 'dtpp-test@local'
    test_extension.mkdir()
    (test_extension / 'metadata.json').write_text(json.dumps({'uuid':'dtpp-test@local','name':'DTPP integration test','description':'Isolated test harness','shell-version':['42'],'version':1}))
    shutil.copyfile(root / 'tests/integration-extension.js', test_extension / 'extension.js')
    for directory in ['runtime','config','cache','state']:
        (tmp / directory).mkdir(mode=0o700)
    env = dict(os.environ, XDG_DATA_HOME=str(tmp/'data'), XDG_CONFIG_HOME=str(tmp/'config'),
               XDG_CACHE_HOME=str(tmp/'cache'), XDG_STATE_HOME=str(tmp/'state'), XDG_RUNTIME_DIR=str(tmp/'runtime'),
               DTPP_TEST_ROOT=str(root), DTPP_TEST_OUTPUT=str(output), GSETTINGS_BACKEND='dconf',
               XDG_SESSION_TYPE='wayland', LIBGL_ALWAYS_SOFTWARE='1', GDK_BACKEND='wayland')
    for key in ['DBUS_SESSION_BUS_ADDRESS','DISPLAY','WAYLAND_DISPLAY','SESSION_MANAGER']:
        env.pop(key, None)
    commands = """
set -eu
gsettings set org.gnome.shell enabled-extensions "['dash-to-panel@jderose9.github.com', 'dash-to-panel-plus@ka.local', 'dtpp-test@local']"
gsettings set org.gnome.shell disabled-extensions "['ubuntu-dock@ubuntu.com', 'ding@rastersoft.com', 'ubuntu-appindicators@ubuntu.com']"
gsettings set org.gnome.shell favorite-apps "['org.gnome.Nautilus.desktop', 'terminator.desktop']"
gsettings set org.gnome.mutter dynamic-workspaces false
gsettings set org.gnome.desktop.wm.preferences num-workspaces 3
gsettings --schemadir "$XDG_DATA_HOME/gnome-shell/extensions/dash-to-panel@jderose9.github.com/schemas" set org.gnome.shell.extensions.dash-to-panel group-apps false
gsettings --schemadir "$XDG_DATA_HOME/gnome-shell/extensions/dash-to-panel@jderose9.github.com/schemas" set org.gnome.shell.extensions.dash-to-panel isolate-workspaces true
gsettings --schemadir "$XDG_DATA_HOME/gnome-shell/extensions/dash-to-panel@jderose9.github.com/schemas" set org.gnome.shell.extensions.dash-to-panel hide-overview-on-startup true
exec /usr/bin/gnome-shell --headless --wayland --no-x11 --virtual-monitor=1280x800 --sm-disable
"""
    with (output / 'gnome.log').open('w') as log:
        process = subprocess.Popen(['/usr/bin/dbus-run-session','--','/bin/bash','-c',commands], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + 50
            while time.monotonic() < deadline and process.poll() is None and not (output/'result.json').exists():
                time.sleep(0.25)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL); process.wait()
            runtime_entry = ('XDG_RUNTIME_DIR=' + str(tmp / 'runtime')).encode()
            for environ in Path('/proc').glob('[0-9]*/environ'):
                try:
                    if runtime_entry in environ.read_bytes().split(b'\0'):
                        os.kill(int(environ.parent.name), signal.SIGTERM)
                except (OSError, ProcessLookupError):
                    pass
            subprocess.run(['/bin/fusermount', '-uz', str(tmp / 'runtime/gvfs')], capture_output=True)
    if not (output/'result.json').exists():
        print((output/'gnome.log').read_text()[-10000:])
        raise SystemExit('GNOME integration did not produce results')
    result=json.loads((output/'result.json').read_text())
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result['success'] else 1)
