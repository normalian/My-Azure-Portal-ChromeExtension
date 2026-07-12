#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/secrets.local.json}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist}"
PLACEHOLDER='__APPINSIGHTS_CONNECTION_STRING__'

mkdir -p "$OUTPUT_DIR"

if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD=(python3)
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD=(python)
elif command -v py >/dev/null 2>&1; then
    PYTHON_CMD=(py -3)
else
    echo "No Python interpreter found. Install python3, python, or py -3 and try again." >&2
    exit 1
fi

"${PYTHON_CMD[@]}" - "$ROOT_DIR" "$SECRETS_FILE" "$OUTPUT_DIR" "$PLACEHOLDER" <<'PY'
import json
import pathlib
import shutil
import sys
import tempfile
import zipfile

root = pathlib.Path(sys.argv[1])
secrets_file = pathlib.Path(sys.argv[2])
output_dir = pathlib.Path(sys.argv[3])
placeholder = sys.argv[4]

if not secrets_file.exists():
    raise SystemExit(f"Missing secrets file: {secrets_file}")

with secrets_file.open('r', encoding='utf-8') as handle:
    secrets = json.load(handle)

connection_string = str(secrets.get('appInsightsConnectionString', '')).strip()
if not connection_string:
    raise SystemExit('secrets.local.json must contain appInsightsConnectionString.')

manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
version = str(manifest.get('version', '0.0.0')).strip() or '0.0.0'
zip_name = f'my-azure-portal-extension-v{version}.zip'

staging = pathlib.Path(tempfile.mkdtemp(prefix='my-azure-portal-extension-'))

def copy_text(src_rel: str, dest_rel=None) -> None:
    dest_rel = dest_rel or src_rel
    src = root / src_rel
    dest = staging / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    text = src.read_text(encoding='utf-8')
    if src.name == 'background.js':
        text = text.replace(placeholder, connection_string)
    dest.write_text(text, encoding='utf-8')

def copy_tree(src_rel: str) -> None:
    src_dir = root / src_rel
    if not src_dir.exists():
        return

    for path in src_dir.rglob('*'):
        if path.is_file():
            dest = staging / path.relative_to(root)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)

for relative_path in [
    'background.js',
    'manifest.json',
    'popup.html',
    'popup.js',
    'onboarding.html',
    'onboarding.js',
    'script.js',
    'jquery-3.5.1.min.js',
    'LICENSE',
]:
    copy_text(relative_path)

for markdown_file in root.glob('*.md'):
    if markdown_file.name in {'secrets.local.json'}:
        continue
    copy_text(markdown_file.name)

copy_tree('css')
copy_tree('img')

zip_path = output_dir / zip_name
with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for file_path in staging.rglob('*'):
        if file_path.is_file():
            archive.write(file_path, file_path.relative_to(staging).as_posix())

print(zip_path)

shutil.rmtree(staging, ignore_errors=True)
PY
