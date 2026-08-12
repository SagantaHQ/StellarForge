#!/usr/bin/env bash
# Build every Soroban template and report which ones compile.
# Run: bash scripts/build-all-templates.sh
#
# Requires: stellar-cli, cargo, rustc, wasm32v1-none target.
# Each template is built in isolation in /tmp/template-test/<id>.

# NOTE: no `set -e` — we want to continue building other templates even if one fails

. "$HOME/.cargo/env"
export PATH="/home/z/.local/bin:$HOME/.cargo/bin:$PATH"

# Verify stellar + cargo are available
if ! command -v stellar >/dev/null 2>&1; then
  echo "✗ stellar-cli not found on PATH"
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "✗ cargo not found on PATH"
  exit 1
fi
echo "Using: $(which stellar)"
echo "Using: $(which cargo)"

REGISTRY_DUMP="/tmp/templates-dump.json"
BUILD_DIR="/tmp/template-test"
mkdir -p "$BUILD_DIR"

# Dump all templates to JSON using a tiny Node script
echo "Dumping templates from registry..."
cat > /tmp/dump-templates.mjs <<'NODE'
import { TEMPLATES } from "/home/z/my-project/src/lib/templates/registry.ts";
import { writeFileSync } from "fs";
// Use bun to run TS directly
NODE

# Use bun to dump templates
cd /home/z/my-project
bun -e '
import { TEMPLATES } from "./src/lib/templates/registry.ts";
import { writeFileSync } from "fs";
writeFileSync("/tmp/templates-dump.json", JSON.stringify(TEMPLATES, null, 2));
console.log("Dumped " + TEMPLATES.length + " templates");
'

# Read each template and build it
TOTAL=$(python3 -c "import json; print(len(json.load(open('$REGISTRY_DUMP'))))")
echo ""
echo "Building $TOTAL templates..."
echo ""

PASS=0
FAIL=0
FAILED_TEMPLATES=""

for i in $(seq 0 $((TOTAL - 1))); do
  ID=$(python3 -c "import json; d=json.load(open('$REGISTRY_DUMP')); print(d[$i]['id'])")
  NAME=$(python3 -c "import json; d=json.load(open('$REGISTRY_DUMP')); print(d[$i]['name'])")
  echo "━━━ [$((i+1))/$TOTAL] $ID ($NAME) ━━━"

  # Extract files to a temp dir
  TEMPLATE_DIR="$BUILD_DIR/$ID"
  rm -rf "$TEMPLATE_DIR"
  mkdir -p "$TEMPLATE_DIR"

  # Write each file
  python3 -c "
import json, os
d = json.load(open('$REGISTRY_DUMP'))[$i]
for f in d['files']:
    path = os.path.join('$TEMPLATE_DIR', f['path'])
    os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(path) else None
    with open(path, 'w') as fh:
        fh.write(f['content'])
"

  # Build
  cd "$TEMPLATE_DIR"
  BUILD_LOG="$TEMPLATE_DIR/build.log"
  if stellar contract build > "$BUILD_LOG" 2>&1; then
    # Check if wasm was produced
    WASM=$(find . -name "*.wasm" -type f | head -1)
    if [ -n "$WASM" ]; then
      echo "  ✓ PASS — wasm: $WASM ($(du -h "$WASM" | cut -f1))"
      PASS=$((PASS+1))
    else
      echo "  ⚠ PASS (exit 0 but no wasm found)"
      PASS=$((PASS+1))
    fi
  else
    echo "  ✗ FAIL — last 25 lines of build log:"
    tail -25 "$BUILD_LOG" | sed 's/^/    /'
    FAIL=$((FAIL+1))
    FAILED_TEMPLATES="$FAILED_TEMPLATES\n    - $ID ($NAME)"
  fi
  cd /home/z/my-project
  echo ""
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RESULTS: $PASS passed, $FAIL failed (out of $TOTAL)"
if [ $FAIL -gt 0 ]; then
  echo ""
  echo "  Failed templates:"
  echo -e "$FAILED_TEMPLATES"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
