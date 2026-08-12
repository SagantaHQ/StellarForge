#!/usr/bin/env bash
# Build a single template by ID.
# Usage: bash scripts/build-one-template.sh <template-id>
# Example: bash scripts/build-one-template.sh hello-world

. "$HOME/.cargo/env"
export PATH="/home/z/.local/bin:$HOME/.cargo/bin:$PATH"

ID="${1:-}"
if [ -z "$ID" ]; then
  echo "Usage: $0 <template-id>"
  exit 1
fi

BUILD_DIR="/tmp/template-test/$ID"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Extract files
cd /home/z/my-project
bun -e "
import { TEMPLATES } from './src/lib/templates/registry.ts';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
const t = TEMPLATES.find(t => t.id === '$ID');
if (!t) { console.error('Template not found: $ID'); process.exit(1); }
for (const f of t.files) {
  const p = join('$BUILD_DIR', f.path);
  if (dirname(p)) mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, f.content);
}
console.log('Extracted ' + t.files.length + ' files for template: ' + t.id);
"

cd "$BUILD_DIR"
echo "Building in: $BUILD_DIR"
echo "Files:"
find . -type f -not -path './target/*' | sort
echo ""
echo "Running: stellar contract build"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
stellar contract build 2>&1
EXIT_CODE=$?
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Exit code: $EXIT_CODE"

if [ $EXIT_CODE -eq 0 ]; then
  WASM=$(find . -name "*.wasm" -type f | head -1)
  if [ -n "$WASM" ]; then
    echo "✓ PASS — wasm: $WASM ($(du -h "$WASM" | cut -f1))"
  else
    echo "⚠ PASS (exit 0 but no wasm found)"
  fi
else
  echo "✗ FAIL"
fi
