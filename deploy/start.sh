#!/bin/sh
# Carys container start: render the site's connect-src, then run nginx.
#
# connect-src is the CSP's one relaxation (see deploy/nginx.conf): the app
# fetches stores the user types in — DICOMweb endpoints, OME-Zarr URLs, the
# IDR mirrors — and a build cannot know those hosts, so the default allows
# any https origin plus loopback. A site that can name its hosts sets
#
#   CARYS_CONNECT_SRC="https://pacs.example.org https://*.s3.example.com"
#
# and the policy allows exactly those (plus 'self'). Leave out a host and the
# browser refuses fetches to it: the Cells catalog's IDR stores need theirs
# listed too. Every token is checked before nginx starts, so a typo — or a
# value carrying `;` to smuggle a directive in — stops the container instead
# of shipping a broken or widened policy.
set -eu

DEFAULT='https: http://localhost:* http://127.0.0.1:*'
src="${CARYS_CONNECT_SRC:-$DEFAULT}"
# a scheme (https:), or an origin with an optional wildcard subdomain, port
# (or :*) and path; never a quote, `;`, `$` or anything else nginx or the CSP
# would read as syntax
token='^((https?|wss?):|(https?|wss?)://(\*\.)?[A-Za-z0-9.-]+(:([0-9]+|\*))?(/[A-Za-z0-9._~/-]*)?)$'

set -f  # a `*` in a token is CSP syntax, not a glob
n=0
for t in $src; do
  if ! printf '%s' "$t" | grep -Eq "$token"; then
    echo "carys: CARYS_CONNECT_SRC token '$t' is not a scheme (https:) or an origin (https://host[:port])" >&2
    exit 64
  fi
  n=$((n + 1))
done
if [ "$n" -eq 0 ]; then
  echo 'carys: CARYS_CONNECT_SRC is set but names no origin' >&2
  exit 64
fi
set +f

# The access gate (deploy/gate.js). Unset or empty: open, and said so. Set:
# a long random key (openssl rand -hex 32), nothing nginx or a URL would
# read as syntax.
if [ -n "${CARYS_ACCESS_KEY:-}" ]; then
  # length apart from the regex: busybox grep caps a {m,n} bound at 255
  if [ "${#CARYS_ACCESS_KEY}" -lt 32 ] || [ "${#CARYS_ACCESS_KEY}" -gt 256 ] \
    || ! printf '%s' "$CARYS_ACCESS_KEY" | grep -Eq '^[A-Za-z0-9_-]+$'; then
    echo 'carys: CARYS_ACCESS_KEY must be 32-256 characters of [A-Za-z0-9_-] (openssl rand -hex 32)' >&2
    exit 64
  fi
  echo 'carys: access gate on (?token=, Bearer, or the session cookie)' >&2
else
  echo 'carys: no CARYS_ACCESS_KEY, so the site is open to anyone who can reach it' >&2
fi

# collapse runs of whitespace; the tokens themselves passed the check above
src=$(printf '%s' "$src" | tr -s ' \t\n' '   ' | sed 's/^ //; s/ $//')
printf 'map $scheme $carys_connect_src { default "%s"; }\n' "$src" > /tmp/carys-connect-src.conf
echo "carys: connect-src 'self' $src" >&2
exec nginx -g 'daemon off;'
