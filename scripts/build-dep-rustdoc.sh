#!/bin/bash
# Generate a rustdoc symbol index for a single crate from the cargo registry.
#
# Usage: bash scripts/build-dep-rustdoc.sh <package-name> <version>
#
# Finds the crate source in ~/.cargo/registry/src/, generates rustdoc JSON,
# parses it into a compact symbol index, and caches it in
# data/rustdoc-index/<package>-<version>.json
#
# If the cached index already exists, exits immediately (idempotent).

set -e

PACKAGE="$1"
VERSION="$2"
export HOME="${HOME:-/home/z}"
source "$HOME/.cargo/env" 2>/dev/null

if [ -z "$PACKAGE" ] || [ -z "$VERSION" ]; then
  echo "Usage: $0 <package-name> <version>"
  echo "Example: $0 stellar-access 0.7.2"
  exit 1
fi

# Normalize package name (replace - with _ for the index file)
INDEX_NAME=$(echo "$PACKAGE" | tr '-' '_')
OUTPUT_DIR="/home/z/my-project/data/rustdoc-index"
OUTPUT_FILE="$OUTPUT_DIR/${INDEX_NAME}-${VERSION}.json"

# Check cache
if [ -f "$OUTPUT_FILE" ]; then
  echo "✓ cached: $OUTPUT_FILE"
  exit 0
fi

mkdir -p "$OUTPUT_DIR"

# Find the crate source in the cargo registry
# The registry path uses hyphens: ~/.cargo/registry/src/index.crates.io-*/stellar-access-0.7.2/
REGISTRY_SRC=$(find "$HOME/.cargo/registry/src" -maxdepth 1 -name "index.crates.io-*" -type d 2>/dev/null | head -1)
if [ -z "$REGISTRY_SRC" ]; then
  echo "ERROR: cargo registry not found. Run a build first to download deps."
  exit 1
fi

CRATE_DIR=$(find "$REGISTRY_SRC" -maxdepth 1 -name "${PACKAGE}-${VERSION}" -type d 2>/dev/null | head -1)
if [ -z "$CRATE_DIR" ]; then
  echo "ERROR: $PACKAGE-$VERSION not found in cargo registry."
  echo "  Searched: $REGISTRY_SRC/${PACKAGE}-${VERSION}"
  echo "  Make sure the package is downloaded (run a build first)."
  exit 1
fi

echo "Generating rustdoc JSON for $PACKAGE $VERSION..."
cd "$CRATE_DIR"

# Generate rustdoc JSON with nightly
cargo +nightly rustdoc -Z unstable-options --output-format json 2>/dev/null

JSON_FILE="target/doc/${INDEX_NAME}.json"
if [ ! -f "$JSON_FILE" ]; then
  echo "ERROR: rustdoc JSON not generated at $JSON_FILE"
  exit 1
fi

# Parse into compact symbol index
python3 - "$JSON_FILE" "$OUTPUT_FILE" "$PACKAGE" "$VERSION" << 'PYEOF'
import json, os, sys

json_path = sys.argv[1]
output_path = sys.argv[2]
package_name = sys.argv[3]
package_version = sys.argv[4]

def type_to_string(t):
    if not t or not isinstance(t, dict): return "?"
    if "primitive" in t: return t["primitive"]
    if "generic" in t: return t["generic"]
    if "resolved_path" in t:
        path = t["resolved_path"]
        name = path.get("path", "")
        if "::" in name: name = name.split("::")[-1]
        args = path.get("args") or {}
        if "angle_bracketed" in args:
            inner_args = args["angle_bracketed"].get("args", [])
            inner_strs = []
            for a in inner_args:
                if "type" in a: inner_strs.append(type_to_string(a["type"]))
                elif "lifetime" in a: inner_strs.append(a["lifetime"])
            if inner_strs: name += f"<{', '.join(inner_strs)}>"
        return name
    if "borrowed_ref" in t:
        br = t["borrowed_ref"]
        lifetime = br.get("lifetime")
        mutable = br.get("is_mutable", False)
        inner = type_to_string(br.get("type"))
        prefix = "&"
        if lifetime: prefix += f"'{lifetime} "
        if mutable: prefix += "mut "
        return f"{prefix}{inner}"
    if "slice" in t: return f"[{type_to_string(t['slice'])}]"
    if "array" in t:
        arr = t["array"]
        return f"[{type_to_string(arr.get('type'))}; {arr.get('len', '?')}]"
    if "tuple" in t:
        elems = t["tuple"]
        if not elems: return "()"
        return f"({', '.join(type_to_string(e) for e in elems)})"
    if "impl_trait" in t:
        ib = t["impl_trait"]
        bounds = ib if isinstance(ib, list) else ib.get("generic_bounds", [])
        trait_strs = []
        for b in bounds:
            tb = b.get("trait_bound", {}).get("trait", {})
            if tb: trait_strs.append(type_to_string(tb))
        return f"impl {', '.join(trait_strs)}" if trait_strs else "impl"
    if "raw_pointer" in t:
        rp = t["raw_pointer"]
        mutable = rp.get("is_mutable", False)
        return f"*{'mut' if mutable else 'const'} {type_to_string(rp.get('type'))}"
    if "fn_pointer" in t:
        fp = t["fn_pointer"]
        inputs = [type_to_string(i[1]) for i in fp.get("sig", {}).get("inputs", [])]
        output = type_to_string(fp.get("sig", {}).get("output"))
        s = f"fn({', '.join(inputs)})"
        if output and output != "()": s += f" -> {output}"
        return s
    return "?"

def fn_signature(name, fn_data):
    sig = fn_data.get("sig", {})
    header = fn_data.get("header", {})
    inputs = sig.get("inputs", [])
    output = sig.get("output")
    params = []
    for inp in inputs:
        if isinstance(inp, list) and len(inp) >= 2:
            params.append(f"{inp[0]}: {type_to_string(inp[1])}")
    prefix = ""
    if header.get("is_async"): prefix += "async "
    if header.get("is_const"): prefix += "const "
    if header.get("is_unsafe"): prefix += "unsafe "
    s = f"{prefix}fn {name}({', '.join(params)})"
    if output and output != "()": s += f" -> {type_to_string(output)}"
    return s

KIND_MAP = {
    "function": "function", "struct": "struct", "enum": "enum",
    "trait": "trait", "constant": "constant", "type_alias": "type_alias",
    "module": "module", "macro": "macro", "static": "static",
}
SKIP_KINDS = {"impl", "struct_field", "assoc_type", "assoc_const", "use", "variant"}

def truncate_docs(docs, max_len=200):
    if not docs: return None
    p = docs.split("\n\n")[0].strip().replace("#", "").replace("`", "")
    if len(p) > max_len: p = p[:max_len] + "..."
    return p

def extract_symbol(item):
    inner = item.get("inner")
    if not inner or not isinstance(inner, dict): return None
    kind = list(inner.keys())[0] if inner else None
    if kind in SKIP_KINDS: return None
    name = item.get("name")
    if not name: return None
    vis = item.get("visibility")
    if vis and vis != "public": return None
    our_kind = KIND_MAP.get(kind)
    if not our_kind: return None
    if name.startswith("_mm") or len(name) > 50: return None
    d = inner.get(kind, {})
    detail = None
    if kind == "function": detail = fn_signature(name, d)
    elif kind == "macro": detail = f"macro! {name}"
    elif kind == "struct":
        fields = d.get("fields", []) if isinstance(d, dict) else []
        detail = f"struct {name}" + (f" {{ {len(fields)} fields }}" if fields else "")
    elif kind == "enum":
        variants = d.get("variants", []) if isinstance(d, dict) else []
        detail = f"enum {name}" + (f" {{ {len(variants)} variants }}" if variants else "")
    elif kind == "trait": detail = f"trait {name}"
    elif kind == "constant":
        ct = type_to_string(d.get("type")) if isinstance(d, dict) else None
        detail = f"const {name}: {ct}" if ct else f"const {name}"
    elif kind == "type_alias":
        ta = type_to_string(d.get("type")) if isinstance(d, dict) else None
        detail = f"type {name} = {ta}" if ta else f"type {name}"
    elif kind == "module": detail = f"mod {name}"
    elif kind == "static":
        st = type_to_string(d.get("type")) if isinstance(d, dict) else None
        mutable = d.get("is_mutable", False) if isinstance(d, dict) else False
        prefix = "static mut" if mutable else "static"
        detail = f"{prefix} {name}: {st}" if st else f"{prefix} {name}"
    return {"name": name, "kind": our_kind, "detail": detail, "docs": truncate_docs(item.get("docs"))}

with open(json_path) as f:
    data = json.load(f)

symbols = []
for item_id, item in data["index"].items():
    sym = extract_symbol(item)
    if sym:
        sym["module"] = package_name
        symbols.append(sym)

# Deduplicate
seen = {}
deduped = []
for sym in symbols:
    key = (sym["name"], sym["kind"])
    if key not in seen:
        seen[key] = True
        deduped.append(sym)

output = {"crate": package_name, "version": package_version, "symbols": deduped, "total_count": len(deduped)}
with open(output_path, "w") as f:
    json.dump(output, f, separators=(",", ":"))

print(f"✓ {package_name} {package_version}: {len(deduped)} symbols → {output_path}")
PYEOF

# Clean up the build artifacts (they can be large)
rm -rf "$CRATE_DIR/target"
