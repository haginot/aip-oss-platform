#!/usr/bin/env bash
set -euo pipefail
# Invoke from the extracted repository root. No developer credentials are read.
test -f mise.toml && test -f package-lock.json || { echo 'run from repository root' >&2; exit 64; }
command -v mise >/dev/null || { echo 'Install OSS mise (documented prerequisite) first' >&2; exit 69; }
# Dedicated profile cache avoids a developer's globally installed binary/features.
export MISE_DATA_DIR="${MISE_DATA_DIR:-$PWD/.release-runtime/data}"
export MISE_CACHE_DIR="${MISE_CACHE_DIR:-$PWD/.release-runtime/cache}"
export MISE_CONFIG_DIR="$MISE_CACHE_DIR/config"
export MISE_TRUSTED_CONFIG_PATHS="$PWD"
export MISE_YES=1
mkdir -p "$MISE_CONFIG_DIR"
export npm_config_userconfig="$MISE_CONFIG_DIR/npmrc"
export npm_config_cache="$MISE_CACHE_DIR/npm"
printf '' > "$npm_config_userconfig"
export POSTGRES_CONFIGURE_OPTIONS='--without-icu --without-readline --without-zlib'
export POSTGRES_SKIP_INITDB=1
# GnuPG agent sockets must stay below the Unix socket path length limit.
release_gpg=$(mktemp -d /tmp/aip-release-gpg-XXXXXX)
chmod 700 "$release_gpg"
export GNUPGHOME="$release_gpg"
release_cleanup() {
  if command -v gpgconf >/dev/null; then gpgconf --homedir "$release_gpg" --kill gpg-agent || true; fi
  rm -rf "$release_gpg"
}
trap release_cleanup EXIT
mise install
release_cleanup
trap - EXIT
unset GNUPGHOME
mise exec -- npm ci --omit=dev --ignore-scripts --no-fund --no-audit
exec mise exec -- node scripts/foundation/serve.mjs --store-demo "$@"
