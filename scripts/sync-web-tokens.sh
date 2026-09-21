#!/usr/bin/env bash
# Keep the NABIN token layer identical across the four Next.js apps.
# customer-web/src/app/globals.css is the master copy; admin-web needs the
# Tailwind @theme bridge in front of it.
#
#   ./scripts/sync-web-tokens.sh          # copy master into every app
#   ./scripts/sync-web-tokens.sh --check  # exit 1 if any app drifted
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MASTER="$ROOT/customer-web/src/app/globals.css"
LINKED=(grocery-merchant-web restaurant-merchant-web)
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

TAILWIND_HEAD=$(cat <<'EOF'
@import "tailwindcss";

@theme inline {
  --color-primary: var(--brand);
  --color-background: var(--canvas);
  --color-foreground: var(--ink);
  --color-surface: var(--surface);
  --color-surface-hover: var(--surface-muted);
  --color-border: var(--divider);
  --color-muted: var(--ink-muted);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);

  --color-primary-hover: var(--brand-hover);
  --color-primary-light: var(--brand-bright);
  --color-secondary: var(--success);
  --color-secondary-hover: var(--success-dark);
  --color-tertiary: var(--food-orange);
  --color-surface-container: var(--surface-muted);
}
EOF
)

drift=0

for app in "${LINKED[@]}"; do
  target="$ROOT/$app/src/app/globals.css"
  [ "$app" = "customer-web" ] && continue
  if [ "$CHECK" = "1" ]; then
    cmp -s "$MASTER" "$target" || { echo "DRIFT: $app"; drift=1; }
  else
    cp "$MASTER" "$target"
  fi
done

admin_target="$ROOT/admin-web/src/app/globals.css"
if [ "$CHECK" = "1" ]; then
  generated="$(mktemp)"
  { printf '%s\n\n' "$TAILWIND_HEAD"; cat "$MASTER"; } > "$generated"
  cmp -s "$generated" "$admin_target" || { echo "DRIFT: admin-web"; drift=1; }
  rm -f "$generated"
else
  { printf '%s\n\n' "$TAILWIND_HEAD"; cat "$MASTER"; } > "$admin_target"
fi

if [ "$CHECK" = "1" ]; then
  [ "$drift" = "0" ] && echo "Token layer in sync across 4 apps."
  exit "$drift"
fi

echo "Token layer copied to 4 apps from $MASTER"
