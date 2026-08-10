#!/bin/bash
# Generate rustdoc JSON for soroban-sdk + soroban-test-utils
# Run once (cached per version), then build a compact symbol index.
#
# Usage: bash scripts/build-soroban-rustdoc.sh

set -e

export HOME="${HOME:-/home/z}"
source "$HOME/.cargo/env" 2>/dev/null

# Check nightly is installed
if ! rustup +nightly --version &>/dev/null; then
  echo "Installing nightly..."
  rustup toolchain install nightly --profile minimal
fi
if ! rustup +nightly component list --installed 2>/dev/null | grep -q rust-docs-json; then
  echo "Adding rust-docs-json component..."
  rustup +nightly component add rust-docs-json
fi

# Create a temp crate that depends on soroban-sdk
WORKDIR="/tmp/soroban-rustdoc-gen"
mkdir -p "$WORKDIR/src"

# Get the latest soroban-sdk version from crates.io
SDK_VERSION=$(curl -sS https://crates.io/api/v1/crates/soroban-sdk | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['crate']['max_stable_version'])")
echo "soroban-sdk version: $SDK_VERSION"

cat > "$WORKDIR/Cargo.toml" << TOML
[package]
name = "soroban-rustdoc-gen"
version = "0.1.0"
edition = "2021"

[dependencies]
soroban-sdk = "$SDK_VERSION"

[lib]
path = "src/lib.rs"
TOML

cat > "$WORKDIR/src/lib.rs" << 'RUST'
// Empty — we only need the dependencies for rustdoc
RUST

echo "Generating rustdoc JSON (this compiles soroban-sdk + deps, may take 5-10 min)..."
cd "$WORKDIR"

# Generate rustdoc JSON with nightly
cargo +nightly rustdoc -Z unstable-options --output-format json 2>&1 | tail -5

# The output is at target/doc/soroban_rustdoc_gen.json
JSON_FILE="$WORKDIR/target/doc/soroban_rustdoc_gen.json"
if [ ! -f "$JSON_FILE" ]; then
  echo "ERROR: rustdoc JSON not found at $JSON_FILE"
  exit 1
fi

echo "✓ rustdoc JSON generated: $(ls -lh $JSON_FILE | awk '{print $5}')"

# Build a compact symbol index
echo "Building compact symbol index..."
OUTPUT_DIR="/home/z/my-project/data/rustdoc-index"
mkdir -p "$OUTPUT_DIR"

python3 - << PYEOF
import json, sys, os

json_path = "$JSON_FILE"
output_path = "$OUTPUT_DIR/soroban-sdk-index.json"

print(f"  parsing {json_path}...", file=sys.stderr)
with open(json_path) as f:
    data = json.load(f)

# Find soroban_sdk in external_crates or paths
crate_name = "soroban_sdk"
crate_version = "$SDK_VERSION"

# The rustdoc JSON for the whole project contains ALL dependencies
# We need to find soroban_sdk items via the paths mapping
paths = data.get("paths", {})
external_crates = data.get("external_crates", {})

# Find soroban_sdk crate id
sdk_crate_id = None
for cid, cinfo in external_crates.items():
    if cinfo.get("name") == "soroban_sdk":
        sdk_crate_id = cid
        break

if sdk_crate_id is None:
    # Try finding via paths
    for pid, pinfo in paths.items():
        if pinfo.get("name") == "soroban_sdk" and pinfo.get("kind") == "crate":
            sdk_crate_id = pinfo.get("crate_id")
            break

print(f"  soroban_sdk crate_id: {sdk_crate_id}", file=sys.stderr)

# Extract all items that belong to soroban_sdk
KIND_MAP = {
    "function": "function",
    "struct": "struct",
    "enum": "enum",
    "trait": "trait",
    "constant": "constant",
    "type_alias": "type_alias",
    "module": "module",
    "macro": "macro",
    "static": "static",
}
SKIP_KINDS = {"impl", "struct_field", "assoc_type", "assoc_const", "use", "variant"}

def truncate_docs(docs, max_len=200):
    if not docs:
        return None
    first_para = docs.split("\\n\\n")[0].strip()
    first_para = first_para.replace("#", "").replace("\`", "")
    if len(first_para) > max_len:
        first_para = first_para[:max_len] + "..."
    return first_para

def extract_signature(item):
    inner = item.get("inner")
    if not inner or not isinstance(inner, dict):
        return None
    name = item.get("name")
    if not name:
        return None
    kind = list(inner.keys())[0] if inner else None
    data_inner = inner.get(kind, {})
    if kind in ("function", "macro"):
        sig = data_inner.get("sig", {}) if isinstance(data_inner, dict) else {}
        inputs = sig.get("inputs", [])
        output = sig.get("output", None)
        params = []
        for inp in inputs:
            if isinstance(inp, list) and len(inp) >= 2:
                params.append(f"{inp[0]}: {inp[1]}")
        prefix = ""
        if sig.get("is_async"): prefix += "async "
        if sig.get("is_const"): prefix += "const "
        if sig.get("is_unsafe"): prefix += "unsafe "
        sig_str = f"{prefix}fn {name}({', '.join(params)})"
        if output and output != "()":
            sig_str += f" -> {output}"
        return sig_str
    elif kind == "struct": return f"struct {name}"
    elif kind == "enum": return f"enum {name}"
    elif kind == "trait": return f"trait {name}"
    elif kind == "constant":
        ct = data_inner.get("type") if isinstance(data_inner, dict) else None
        return f"const {name}: {ct}" if ct else f"const {name}"
    elif kind == "type_alias": return f"type {name}"
    elif kind == "module": return f"mod {name}"
    elif kind == "static":
        st = data_inner.get("type") if isinstance(data_inner, dict) else None
        return f"static {name}: {st}" if st else f"static {name}"
    return None

symbols = []
for item_id, item in data["index"].items():
    inner = item.get("inner")
    if not inner or not isinstance(inner, dict):
        continue
    kind = list(inner.keys())[0] if inner else None
    if kind in SKIP_KINDS:
        continue
    name = item.get("name")
    if not name:
        continue
    vis = item.get("visibility")
    if vis and vis != "public":
        continue
    # Only include items from soroban_sdk crate
    item_crate = item.get("crate_id")
    if sdk_crate_id is not None and item_crate != sdk_crate_id:
        continue
    our_kind = KIND_MAP.get(kind)
    if not our_kind:
        continue
    if name.startswith("_mm") or len(name) > 50:
        continue
    detail = extract_signature(item)
    docs = truncate_docs(item.get("docs"))
    symbols.append({"name": name, "kind": our_kind, "detail": detail, "docs": docs})

# Deduplicate
seen = {}
deduped = []
for sym in symbols:
    key = (sym["name"], sym["kind"])
    if key not in seen:
        seen[key] = True
        deduped.append(sym)

output = {
    "crate": crate_name,
    "version": crate_version,
    "symbols": deduped,
    "total_count": len(deduped),
}

with open(output_path, "w") as f:
    json.dump(output, f, separators=(",", ":"))

print(f"\n✓ wrote {output_path}", file=sys.stderr)
print(f"  total symbols: {len(deduped)}", file=sys.stderr)
print(f"  file size: {os.path.getsize(output_path) / 1024:.1f} KB", file=sys.stderr)
PYEOF

echo "Done!"
