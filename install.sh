#!/usr/bin/env bash
# Compatibility entry point; keep the installer implementation in one place.
set -euo pipefail

script_path="${BASH_SOURCE[0]:-}"
if [[ -f "$script_path" ]]; then
  script_dir="$(cd -- "$(dirname -- "$script_path")" && pwd)"
  if [[ -f "$script_dir/installer/install.sh" ]]; then
    exec bash "$script_dir/installer/install.sh" "$@"
  fi
fi

# Also support the published raw/Pages URL when piped into bash.
curl -fsSL https://raw.githubusercontent.com/bizbazboz/Omnix/refs/heads/main/installer/install.sh | bash -s -- "$@"
