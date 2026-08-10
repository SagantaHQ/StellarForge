#!/usr/bin/env python3
"""
Build a compact symbol index from rustdoc JSON files.

Reads rustdoc JSON (from `rustup +nightly component add rust-docs-json` or
`cargo +nightly rustdoc -Z unstable-options --output-format json`) and
produces a compact JSON index optimized for Monaco autocomplete.

Output format:
{
  "crates": {
    "core": { "version": "...", "symbols": [...] },
    "std": { ... },
    "alloc": { ... }
  }
}

Each symbol: { name, kind, detail, docs?, signature? }
  kind: "function" | "struct" | "enum" | "trait" | "constant" | "type_alias" | "module" | "macro" | "method" | "variant" | "static"
  detail: e.g. "fn foo(x: i32) -> bool" or "struct Foo"
  docs: first paragraph of doc comments (truncated to 200 chars)
"""

import json
import sys
import os
from pathlib import Path

# Map rustdoc inner kinds to our symbol kinds
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

# Kinds we skip (not useful for autocomplete)
SKIP_KINDS = {"impl", "struct_field", "assoc_type", "assoc_const", "use", "variant"}


def truncate_docs(docs, max_len=200):
    if not docs:
        return None
    # Take first paragraph
    first_para = docs.split("\n\n")[0].strip()
    # Remove markdown headers/links
    first_para = first_para.replace("#", "").replace("`", "")
    if len(first_para) > max_len:
        first_para = first_para[:max_len] + "..."
    return first_para


def extract_signature(item):
    """Extract a human-readable signature from a rustdoc item."""
    inner = item.get("inner")
    if not inner or not isinstance(inner, dict):
        return None

    name = item.get("name")
    if not name:
        return None

    kind = list(inner.keys())[0] if inner else None
    data = inner.get(kind, {})

    if kind == "function" or kind == "macro":
        # sig: { inputs: [[name, type]], output: type, is_const, is_async, is_unsafe }
        sig = data.get("sig", {}) if isinstance(data, dict) else {}
        inputs = sig.get("inputs", [])
        output = sig.get("output", None)

        params = []
        for inp in inputs:
            if isinstance(inp, list) and len(inp) >= 2:
                params.append(f"{inp[0]}: {inp[1]}")

        prefix = ""
        if sig.get("is_async"):
            prefix += "async "
        if sig.get("is_const"):
            prefix += "const "
        if sig.get("is_unsafe"):
            prefix += "unsafe "

        sig_str = f"{prefix}fn {name}({', '.join(params)})"
        if output and output != "()":
            sig_str += f" -> {output}"
        return sig_str

    elif kind == "struct":
        return f"struct {name}"

    elif kind == "enum":
        return f"enum {name}"

    elif kind == "trait":
        return f"trait {name}"

    elif kind == "constant":
        const_type = data.get("type") if isinstance(data, dict) else None
        return f"const {name}: {const_type}" if const_type else f"const {name}"

    elif kind == "type_alias":
        return f"type {name}"

    elif kind == "module":
        return f"mod {name}"

    elif kind == "static":
        static_type = data.get("type") if isinstance(data, dict) else None
        return f"static {name}: {static_type}" if static_type else f"static {name}"

    return None


def parse_rustdoc_json(json_path, crate_name=None):
    """Parse a rustdoc JSON file and extract symbols."""
    print(f"  parsing {json_path}...", file=sys.stderr)
    with open(json_path) as f:
        data = json.load(f)

    # Get crate name + version
    if not crate_name:
        root_id = data.get("root")
        root_item = data["index"].get(str(root_id)) if root_id else None
        crate_name = root_item.get("name") if root_item else "unknown"

    crate_version = data.get("crate_version", "unknown")
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

        # Skip private items
        vis = item.get("visibility")
        if vis and vis != "public":
            continue

        our_kind = KIND_MAP.get(kind)
        if not our_kind:
            continue

        # Skip items with weird names (like _mm256_cvtusepi64_epi32)
        if name.startswith("_mm") or name.startswith("_bittest"):
            continue

        # Skip names that are too long (likely intrinsics)
        if len(name) > 50:
            continue

        detail = extract_signature(item)
        docs = truncate_docs(item.get("docs"))

        symbols.append({
            "name": name,
            "kind": our_kind,
            "detail": detail,
            "docs": docs,
        })

    # Deduplicate by name+kind (keep first occurrence with docs)
    seen = {}
    deduped = []
    for sym in symbols:
        key = (sym["name"], sym["kind"])
        if key not in seen:
            seen[key] = True
            deduped.append(sym)

    print(f"    {crate_name}: {len(deduped)} symbols (from {len(symbols)} raw)", file=sys.stderr)
    return {
        "version": crate_version,
        "symbols": deduped,
    }


def main():
    toolchain_dir = os.path.expanduser(
        "~/.rustup/toolchains/nightly-x86_64-unknown-linux-gnu"
    )
    json_dir = f"{toolchain_dir}/share/doc/rust/json"

    if not os.path.isdir(json_dir):
        print(f"ERROR: rustdoc JSON dir not found: {json_dir}", file=sys.stderr)
        print("Run: rustup +nightly component add rust-docs-json", file=sys.stderr)
        sys.exit(1)

    output_path = "/home/z/my-project/data/rustdoc-index/std-index.json"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Parse the standard library crates
    crates = {}
    for crate_file in ["core", "std", "alloc"]:
        json_path = f"{json_dir}/{crate_file}.json"
        if os.path.exists(json_path):
            crates[crate_file] = parse_rustdoc_json(json_path, crate_file)
        else:
            print(f"  WARNING: {json_path} not found, skipping", file=sys.stderr)

    # Merge all std symbols into a single flat list
    all_symbols = []
    for crate_name, crate_data in crates.items():
        for sym in crate_data["symbols"]:
            sym["module"] = crate_name
            all_symbols.append(sym)

    output = {
        "crates": crates,
        "all_symbols": all_symbols,
        "total_count": len(all_symbols),
    }

    with open(output_path, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    print(f"\n✓ wrote {output_path}", file=sys.stderr)
    print(f"  total symbols: {len(all_symbols)}", file=sys.stderr)
    print(f"  file size: {os.path.getsize(output_path) / 1024 / 1024:.1f} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
