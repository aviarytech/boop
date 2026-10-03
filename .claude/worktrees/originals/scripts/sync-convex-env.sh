#!/usr/bin/env bash
# Push every server-side var from a dotenv file into Convex.
# Skips VITE_* (client-only), but mirrors VITE_X -> X if X isn't set.
#
# Usage: sync-convex-env.sh [<env-file>] [<dev|prod>]
set -euo pipefail

ENV_FILE="${1:-.env.local}"
TARGET="${2:-dev}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: env file not found: $ENV_FILE" >&2
  exit 1
fi
if [[ "$TARGET" != "dev" && "$TARGET" != "prod" ]]; then
  echo "Error: target must be 'dev' or 'prod', got: $TARGET" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

count=0
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  key="${line%%=*}"
  key="${key#export }"
  key="${key// /}"
  [[ -z "$key" || ! "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] && continue
  # CONVEX_* identifies the deployment target itself — never push into Convex.
  [[ "$key" == CONVEX_* ]] && continue

  # Mirror VITE_X -> X if X isn't already in the file.
  if [[ "$key" == VITE_* ]]; then
    bare="${key#VITE_}"
    if grep -qE "^[[:space:]]*(export[[:space:]]+)?${bare}=" "$ENV_FILE"; then
      continue
    fi
    key="$bare"
    val="${!key:-}"
  else
    val="${!key:-}"
  fi
  [[ -z "$val" ]] && continue

  if [[ "$TARGET" == "prod" ]]; then
    npx convex env set --prod "$key" "$val"
  else
    npx convex env set "$key" "$val"
  fi
  count=$((count + 1))
done < "$ENV_FILE"

echo "Done: synced $count var(s) to Convex ($TARGET)"
