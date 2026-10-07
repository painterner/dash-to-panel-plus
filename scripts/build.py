#!/usr/bin/python3
"""Build a self-contained GNOME extension ZIP without modifying the installation."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
UUID = 'dash-to-panel-plus@ka.local'

def build():
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    archive = dist / (UUID + '.shell-extension.zip')
    with tempfile.TemporaryDirectory(prefix='dtpp-build-') as folder:
        stage = Path(folder) / UUID
        shutil.copytree(ROOT / 'extension', stage)
        subprocess.run(['glib-compile-schemas', '--strict', str(stage / 'schemas')], check=True)
        shutil.copyfile(ROOT / 'COPYING', stage / 'COPYING')
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
            for path in sorted(stage.rglob('*')):
                if path.is_file(): package.write(path, path.relative_to(stage))
    return archive

if __name__ == '__main__':
    print(build())
