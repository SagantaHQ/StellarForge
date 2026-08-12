#!/usr/bin/env python3
"""
Fix OZ templates to use the proper 3-file layout (lib.rs + contract.rs + test.rs)
matching the OpenZeppelin examples structure.

The previous version put contract.rs content directly in src/lib.rs, which broke
because:
  1. contract.rs files don't have `#![no_std]` (it's in lib.rs)
  2. test.rs files use `extern crate std;` + `mod contract` references
  3. The test files reference `crate::contract::ExampleContract` etc.

This script updates registry.ts to use the proper OZ layout for all OZ templates.
"""

import os, re

REGISTRY = "/home/z/my-project/src/lib/templates/registry.ts"
OZ_EXAMPLES = "/tmp/stellar-contracts/examples"
OZ_VER = "0.7.2"
OZ_SDK = "26.1.0"

def read_oz(example, filename):
    path = os.path.join(OZ_EXAMPLES, example, filename)
    with open(path) as f:
        return f.read()

def esc(s):
    """Escape for JS template literal."""
    return s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

def cargo_toml(name, deps):
    dep_lines = "\n".join(f'{d} = "{OZ_VER}"' for d in deps)
    return f"""[package]
name = "{name}"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]
doctest = false

[dependencies]
soroban-sdk = "{OZ_SDK}"
{dep_lines}

[dev-dependencies]
soroban-sdk = {{ version = "{OZ_SDK}", features = ["testutils"] }}

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
"""

# The lib.rs file for OZ templates — same pattern as OZ examples
LIB_RS = """#![no_std]
#![allow(dead_code)]

mod contract;
#[cfg(test)]
mod test;
"""

def template(tid, name, desc, cat, tags, c_from, c_to, contract_rs, test_rs, toml, readme):
    return f'''  // ---------------------------------------------------------------
  // {name}
  // ---------------------------------------------------------------
  {{
    id: "{tid}",
    name: "{name}",
    description: "{desc}",
    category: "{cat}",
    ozWizardUrl: "https://docs.openzeppelin.com/stellar-contracts",
    sorobanSdkVersion: "{OZ_SDK}",
    preview: {{ from: "{c_from}", to: "{c_to}" }},
    tags: {tags},
    files: [
      {{
        path: "src/lib.rs",
        language: "rust",
        content: `{esc(LIB_RS)}`,
      }},
      {{
        path: "src/contract.rs",
        language: "rust",
        content: `{esc(contract_rs)}`,
      }},
      {{
        path: "src/test.rs",
        language: "rust",
        content: `{esc(test_rs)}`,
      }},
      {{
        path: "Cargo.toml",
        language: "toml",
        content: `{esc(toml)}`,
      }},
      {{
        path: "README.md",
        language: "markdown",
        content: `{esc(readme)}`,
      }},
      {{ path: ".gitignore", language: "plaintext", content: GITIGNORE }},
    ],
  }},'''

# Read all OZ example files
examples = {
    "oz-ownable": ("ownable", "Ownable Contract", "Ownership control with #[only_owner] macro.",
                   "utility", '["openzeppelin","ownable","access-control"]',
                   "#7B5CB8", "#5A3F94",
                   ["stellar-access", "stellar-macros"]),
    "oz-fungible-token": ("fungible-votes", "OZ Fungible + Votes",
                          "Fungible token with voting delegation + burnable + ownable.",
                          "token", '["openzeppelin","token","fungible","votes"]',
                          "#8B5CF6", "#6D28D9",
                          ["stellar-access", "stellar-governance", "stellar-macros", "stellar-tokens"]),
    "oz-fungible-pausable": ("fungible-pausable", "Fungible Pausable",
                             "SEP-41 fungible token with pausable transfers + burnable.",
                             "token", '["openzeppelin","token","fungible","pausable"]',
                             "#F59E0B", "#D97706",
                             ["stellar-contract-utils", "stellar-macros", "stellar-tokens"]),
    "oz-nft": ("nft-sequential-minting", "NFT (OZ)",
               "Non-fungible token with sequential minting + burnable.",
               "token", '["openzeppelin","nft","erc721","token"]',
               "#EC4899", "#BE185D",
               ["stellar-tokens"]),
    "oz-pausable": ("pausable", "Pausable",
                    "Emergency stop with #[when_not_paused] / #[when_paused] macros.",
                    "utility", '["openzeppelin","pausable","emergency"]',
                    "#EF4444", "#B91C1C",
                    ["stellar-contract-utils", "stellar-macros"]),
    "oz-upgradeable": ("upgradeable/v1", "Upgradeable",
                       "Contract with WASM upgrade capability.",
                       "utility", '["openzeppelin","upgradeable","upgrade"]',
                       "#06B6D4", "#0891B2",
                       ["stellar-access", "stellar-contract-utils", "stellar-macros"]),
}

templates = []
for tid, (oz_example, name, desc, cat, tags, c_from, c_to, deps) in examples.items():
    contract_rs = read_oz(oz_example, "src/contract.rs")
    test_rs = read_oz(oz_example, "src/test.rs")
    toml = cargo_toml(tid, deps)
    readme = f"# {name} (OpenZeppelin)\n\nBuilt on OpenZeppelin Stellar Contracts v{OZ_VER}.\n\n## Build\n```sh\nstellar contract build\n```\n"
    templates.append((tid, template(tid, name, desc, cat, tags, c_from, c_to, contract_rs, test_rs, toml, readme)))

# Read current registry
with open(REGISTRY) as f:
    content = f.read()

def replace_template(content, tid, new_block):
    id_line = f'    id: "{tid}",'
    idx = content.find(id_line)
    if idx == -1:
        print(f"  ⚠ not found: {tid}")
        return content
    start = content.rfind('  {', 0, idx)
    end = content.find('\n  },', idx)
    if start == -1 or end == -1:
        print(f"  ⚠ braces not found: {tid}")
        return content
    end += len('\n  },')
    return content[:start] + new_block + content[end:]

for tid, block in templates:
    print(f"Replacing {tid}...")
    content = replace_template(content, tid, block)

with open(REGISTRY, "w") as f:
    f.write(content)

print(f"✓ Done. File size: {len(content)} bytes")
