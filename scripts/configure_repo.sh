#!/usr/bin/env bash
set -euo pipefail
# Run locally with an authenticated GitHub CLI. Pass the verified live URL.
gh repo edit gaureshpai/docx-ray \
  --description 'Look inside Word documents: raw XML explorer, visual mappings, and an offline Python CLI.' \
  --add-topic docx --add-topic ooxml --add-topic xml --add-topic python --add-topic cli
if [[ $# -gt 0 ]]; then
  gh repo edit gaureshpai/docx-ray --homepage "$1"
fi
