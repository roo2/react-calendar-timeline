#!/usr/bin/env sh
# Heroku: rebuild vendor/react-calendar-timeline only when the submodule revision changed.
# Uses $CACHE_DIR (set by Heroku buildpacks) to store the last built gitlink + dist/.

set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

VENDOR_DIR="vendor/react-calendar-timeline"
STAMP_FILE="${CACHE_DIR:-}/react-calendar-timeline-submodule.sha"
DIST_CACHE="${CACHE_DIR:-}/react-calendar-timeline-dist"

# Commit being built (Heroku sets this during compile; more reliable than HEAD in some checkouts).
build_ref="${SOURCE_VERSION:-}"
if [ -z "$build_ref" ]; then
  build_ref=$(git rev-parse HEAD 2>/dev/null || true)
fi

# Submodule revision recorded in the superproject tree (mode 160000 gitlink).
# Prefer `git ls-tree`: it only needs the parent commit's tree, not the submodule commit object.
# `git rev-parse --verify HEAD:path` fails on shallow clones because --verify requires the submodule
# commit to exist locally — common on Heroku — which always triggered a full vendor build.
current_sha=""
if command -v git >/dev/null 2>&1 && [ -n "$build_ref" ]; then
  current_sha=$(git ls-tree "$build_ref" -- "$VENDOR_DIR" 2>/dev/null | awk '$1 == "160000" { print $3; exit }' || true)
fi
if [ -z "$current_sha" ] && command -v git >/dev/null 2>&1; then
  current_sha=$(git ls-tree HEAD -- "$VENDOR_DIR" 2>/dev/null | awk '$1 == "160000" { print $3; exit }' || true)
fi
if [ -z "$current_sha" ] && command -v git >/dev/null 2>&1; then
  if [ -n "$build_ref" ] && git rev-parse "${build_ref}:${VENDOR_DIR}" >/dev/null 2>&1; then
    current_sha=$(git rev-parse "${build_ref}:${VENDOR_DIR}" 2>/dev/null || true)
  elif git rev-parse "HEAD:${VENDOR_DIR}" >/dev/null 2>&1; then
    current_sha=$(git rev-parse "HEAD:${VENDOR_DIR}" 2>/dev/null || true)
  fi
fi
if [ -z "$current_sha" ] && command -v git >/dev/null 2>&1 && { [ -d "${VENDOR_DIR}/.git" ] || [ -f "${VENDOR_DIR}/.git" ]; }; then
  current_sha=$(git -C "${VENDOR_DIR}" rev-parse HEAD 2>/dev/null || true)
fi
# Last resort: fingerprint vendor lockfiles so cache can still skip when not a git submodule checkout.
if [ -z "$current_sha" ] && [ -f "${VENDOR_DIR}/package-lock.json" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    current_sha=$( (cat "${VENDOR_DIR}/package.json" 2>/dev/null; cat "${VENDOR_DIR}/package-lock.json") | sha256sum | awk '{print "lock:" $1}' )
  elif command -v shasum >/dev/null 2>&1; then
    current_sha=$( (cat "${VENDOR_DIR}/package.json" 2>/dev/null; cat "${VENDOR_DIR}/package-lock.json") | shasum -a 256 | awk '{print "lock:" $1}' )
  fi
fi

restore_from_cache() {
  rm -rf "${VENDOR_DIR}/dist"
  mkdir -p "${VENDOR_DIR}/dist"
  cp -R "${DIST_CACHE}/." "${VENDOR_DIR}/dist/"
}

if [ -z "$current_sha" ]; then
  echo "scripts/heroku-vendor-timeline.sh: could not read submodule revision; running full vendor build."
elif [ "${FORCE_VENDOR_TIMELINE_BUILD:-}" = "1" ]; then
  echo "scripts/heroku-vendor-timeline.sh: FORCE_VENDOR_TIMELINE_BUILD=1; ignoring cache."
elif [ -n "${CACHE_DIR:-}" ] && [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE")" = "$current_sha" ] && [ -f "${DIST_CACHE}/react-calendar-timeline.es.js" ]; then
  echo "scripts/heroku-vendor-timeline.sh: submodule still at ${current_sha}; using cached dist (skipping npm ci/build)."
  restore_from_cache
  exit 0
fi

echo "scripts/heroku-vendor-timeline.sh: building react-calendar-timeline (${current_sha:-unknown})…"
npm --prefix "$VENDOR_DIR" ci --include=dev
npm --prefix "$VENDOR_DIR" run build

if [ -n "${CACHE_DIR:-}" ] && [ -n "$current_sha" ]; then
  printf '%s\n' "$current_sha" > "$STAMP_FILE"
  rm -rf "$DIST_CACHE"
  mkdir -p "$DIST_CACHE"
  cp -R "${VENDOR_DIR}/dist/." "$DIST_CACHE/"
fi
