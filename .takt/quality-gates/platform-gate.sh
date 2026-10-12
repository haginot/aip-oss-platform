#!/usr/bin/env bash
set -euo pipefail

stage="${1:-}"
if [[ -z "$stage" ]]; then
  echo "usage: platform-gate.sh <stage>" >&2
  exit 64
fi

case "$stage" in
  goal|plan)
    mise exec -- node scripts/platform-control.mjs validate "$stage"
    ;;
  architecture)
    mise exec -- node scripts/platform-control.mjs run-stage architecture
    mise exec -- node scripts/platform-control.mjs validate architecture-receipt
    ;;
  implementation)
    mise exec -- node scripts/platform-control.mjs run-stage implementation
    mise exec -- node scripts/platform-control.mjs validate implementation
    ;;
  demo)
    mise exec -- node scripts/platform-control.mjs run-stage implementation
    mise exec -- node scripts/platform-control.mjs run-stage demo
    mise exec -- node scripts/platform-control.mjs validate demo
    ;;
  bcp)
    mise exec -- node scripts/platform-control.mjs run-stage implementation
    mise exec -- node scripts/platform-control.mjs run-stage demo
    mise exec -- node scripts/platform-control.mjs run-stage bcp
    mise exec -- node scripts/platform-control.mjs validate bcp
    ;;
  release)
    mise exec -- node scripts/platform-control.mjs run-stage architecture
    mise exec -- node scripts/platform-control.mjs run-stage plan
    mise exec -- node scripts/platform-control.mjs run-stage mechanism
    mise exec -- node scripts/platform-control.mjs run-stage implementation
    mise exec -- node scripts/platform-control.mjs run-stage demo
    mise exec -- node scripts/platform-control.mjs run-stage bcp
    mise exec -- node scripts/platform-control.mjs run-stage release
    mise exec -- node scripts/platform-control.mjs validate release
    mise exec -- node scripts/release/current-input-audit.mjs --all
    ;;
  final)
    mise exec -- node scripts/platform-control.mjs validate final
    mise exec -- node scripts/release/current-input-audit.mjs --all
    ;;
  *)
    echo "unknown platform gate stage: $stage" >&2
    exit 64
    ;;
esac
