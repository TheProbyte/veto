#!/usr/bin/env bash
# Music lives in Workers KV (key "media:<file>") so it doesn't count toward the Worker bundle limit.
# Served by the worker at /media/<file>. Re-run after changing any file here.
set -euo pipefail
cd "$(dirname "$0")"
for f in *.mp3; do
  npx wrangler kv key put --binding CACHE --remote "media:$f" --path "$f"
done
