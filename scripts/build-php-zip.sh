#!/usr/bin/env bash
# Builds dist/open-qr-php.zip: the PHP port plus the web frontend, ready to
# upload to shared hosting (Strato & co.). Unzip into the web root, open the
# domain, follow the installer.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/dist/open-qr"
zip="$root/dist/open-qr-php.zip"

rm -rf "$out" "$zip"
mkdir -p "$out"

cp -a "$root/php/." "$out/"
cp -a "$root/app/static/." "$out/static/"

# Never ship local state from test runs.
rm -f "$out"/data/config.php "$out"/data/*.sqlite* "$out"/data/*.lock "$out"/data/*.tmp*
find "$out" -name '.DS_Store' -delete


(cd "$root/dist" && zip -qr -X "$zip" open-qr)
echo "built $zip ($(du -h "$zip" | cut -f1))"
unzip -l "$zip" | grep -E '\.htaccess$' | sed 's/^/  /'
