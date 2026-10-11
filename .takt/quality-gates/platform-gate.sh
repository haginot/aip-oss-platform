#!/usr/bin/env bash
set -euo pipefail

stage="${1:-}"
if [[ -z "$stage" ]]; then
  echo "usage: platform-gate.sh <stage>" >&2
  exit 64
fi

case "$stage" in
  goal|architecture|plan)
    node scripts/platform-control.mjs validate "$stage"
    ;;
  implementation)
    node scripts/platform-control.mjs run-stage implementation
    node scripts/platform-control.mjs validate implementation
    ;;
  demo)
    node scripts/platform-control.mjs run-stage implementation
    node scripts/platform-control.mjs run-stage demo
    node scripts/platform-control.mjs validate demo
    ;;
  bcp)
    node scripts/platform-control.mjs run-stage implementation
    node scripts/platform-control.mjs run-stage demo
    node scripts/platform-control.mjs run-stage bcp
    node scripts/platform-control.mjs validate bcp
    ;;
  release)
    node scripts/platform-control.mjs run-stage mechanism
    node scripts/platform-control.mjs run-stage implementation
    node scripts/platform-control.mjs run-stage demo
    node scripts/platform-control.mjs run-stage bcp
    node scripts/platform-control.mjs run-stage release
    node scripts/platform-control.mjs validate release
    ;;
  final)
    node scripts/platform-control.mjs validate final
    ;;
  *)
    echo "unknown platform gate stage: $stage" >&2
    exit 64
    ;;
esac
