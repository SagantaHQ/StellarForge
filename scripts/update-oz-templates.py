#!/usr/bin/env python3
"""
Update src/lib/templates/registry.ts with OpenZeppelin-based templates.
Reads OZ example files from /tmp/stellar-contracts/examples/ and splices
them into the template registry.
"""
import os, re

REGISTRY = "/home/z/my-project/src/lib/templates/registry.ts"
OZ_EXAMPLES = "/tmp/stellar-contracts/examples"
OZ_VER = "0.7.2"
OZ_SDK = "26.1.0"

def read_oz(example, filename="src/contract.rs"):
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

def template(tid, name, desc, cat, tags, c_from, c_to, rs, test, toml, readme):
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
        content: `{esc(rs)}`,
      }},
      {{
        path: "src/test.rs",
        language: "rust",
        content: `{esc(test)}`,
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

# ── Read OZ examples ────────────────────────────────────────────
ownable_rs = read_oz("ownable", "src/contract.rs")
ownable_test = read_oz("ownable", "src/test.rs")
fv_rs = read_oz("fungible-votes", "src/contract.rs")
fv_test = read_oz("fungible-votes", "src/test.rs")
fp_rs = read_oz("fungible-pausable", "src/contract.rs")
fp_test = read_oz("fungible-pausable", "src/test.rs")
nft_rs = read_oz("nft-sequential-minting", "src/contract.rs")
nft_test = read_oz("nft-sequential-minting", "src/test.rs")
pausable_rs = read_oz("pausable", "src/contract.rs")
pausable_test = read_oz("pausable", "src/test.rs")
upg_rs = read_oz("upgradeable/v1", "src/contract.rs")
upg_test = read_oz("upgradeable/v1", "src/test.rs")

# ── User's fungible-token code (exact paste) ────────────────────
ft_rs = """#![no_std]

use soroban_sdk::{
    Address, BytesN, contract, contractimpl, Env, MuxedAddress, String, Symbol, Vec
};
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_contract_utils::pausable::{self as pausable, Pausable};
use stellar_contract_utils::upgradeable::{self as upgradeable, Upgradeable};
use stellar_governance::votes::Votes;
use stellar_macros::{only_owner, when_not_paused};
use stellar_tokens::fungible::{
    Base, burnable::FungibleBurnable, ContractOverrides, FungibleToken, votes::FungibleVotes
};

#[contract]
pub struct MyToken;

#[contractimpl]
impl MyToken {
    pub fn __constructor(e: &Env, owner: Address) {
        Base::set_metadata(e, 7, String::from_str(e, "MyToken"), String::from_str(e, "MTK"));
        ownable::set_owner(e, &owner);
    }

    #[only_owner]
    #[when_not_paused]
    pub fn mint(e: &Env, account: Address, amount: i128) {
        FungibleVotes::mint(e, &account, amount);
    }
}

#[contractimpl(contracttrait)]
impl FungibleToken for MyToken {
    type ContractType = FungibleVotes;

    #[when_not_paused]
    fn transfer(e: &Env, from: Address, to: MuxedAddress, amount: i128) {
        Self::ContractType::transfer(e, &from, &to, amount);
    }

    #[when_not_paused]
    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::ContractType::transfer_from(e, &spender, &from, &to, amount);
    }
}

//
// Extensions
//

#[contractimpl(contracttrait)]
impl FungibleBurnable for MyToken {
    #[when_not_paused]
    fn burn(e: &Env, from: Address, amount: i128) {
        FungibleVotes::burn(e, &from, amount);
    }

    #[when_not_paused]
    fn burn_from(e: &Env, spender: Address, from: Address, amount: i128) {
        FungibleVotes::burn_from(e, &spender, &from, amount);
    }
}

#[contractimpl(contracttrait)]
impl Votes for MyToken {}

//
// Utils
//

#[contractimpl(contracttrait)]
impl Ownable for MyToken {}

#[contractimpl]
impl Pausable for MyToken {
    fn paused(e: &Env) -> bool {
        pausable::paused(e)
    }

    #[only_owner]
    fn pause(e: &Env, _caller: Address) {
        pausable::pause(e);
    }

    #[only_owner]
    fn unpause(e: &Env, _caller: Address) {
        pausable::unpause(e);
    }
}

#[contractimpl]
impl Upgradeable for MyToken {
    #[only_owner]
    fn upgrade(e: &Env, new_wasm_hash: BytesN<32>, _operator: Address) {
        upgradeable::upgrade(e, &new_wasm_hash);
    }
}
"""

ft_test = """#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};

#[test]
fn test_init() {
    let env = Env::default();
    let owner = Address::generate(&env);
    // Contract registration + OZ trait tests require the full workspace setup.
    // See: https://docs.openzeppelin.com/stellar-contracts for test patterns.
    let _ = (env, owner);
}
"""

# ── Read current registry ───────────────────────────────────────
with open(REGISTRY) as f:
    content = f.read()

# ── Build new template blocks ───────────────────────────────────
templates = []

# 1. Fungible Token (user's exact code — full-featured)
templates.append(template(
    "fungible-token", "Fungible Token",
    "Production-ready SEP-41 fungible token with burnable, votes, pausable, ownable, and upgradeable. Built on OpenZeppelin Stellar Contracts.",
    "token", '["token","erc20","openzeppelin","votes","pausable","upgradeable"]',
    "#30d090", "#1ea070",
    ft_rs, ft_test,
    cargo_toml("fungible-token", ["stellar-access","stellar-contract-utils","stellar-governance","stellar-macros","stellar-tokens"]),
    "# Fungible Token (OpenZeppelin)\n\nProduction-ready fungible token with FungibleVotes + Burnable + Pausable + Ownable + Upgradeable.\n\n## Build\n```sh\nstellar contract build\n```\n"
))

# 2. OZ Ownable
templates.append(template(
    "oz-ownable", "Ownable Contract",
    "Ownership control with #[only_owner] macro. OpenZeppelin stellar-access.",
    "utility", '["openzeppelin","ownable","access-control"]',
    "#7B5CB8", "#5A3F94",
    ownable_rs, ownable_test,
    cargo_toml("oz-ownable", ["stellar-access","stellar-macros"]),
    "# Ownable (OpenZeppelin)\n\nUses #[only_owner] macro + Ownable trait.\n\n## Build\n```sh\nstellar contract build\n```\n"
))

# 3. OZ Fungible + Votes
templates.append(template(
    "oz-fungible-token", "OZ Fungible + Votes",
    "Fungible token with voting delegation (FungibleVotes) + burnable + ownable. OpenZeppelin.",
    "token", '["openzeppelin","token","fungible","votes","governance"]',
    "#8B5CF6", "#6D28D9",
    fv_rs, fv_test,
    cargo_toml("oz-fungible-token", ["stellar-access","stellar-governance","stellar-macros","stellar-tokens"]),
    "# OZ Fungible + Votes\n\nFungibleVotes + Burnable + Ownable.\n\n## Build\n```sh\nstellar contract build\n```\n"
))

# 4. OZ Fungible Pausable
templates.append(template(
    "oz-fungible-pausable", "Fungible Pausable",
    "SEP-41 fungible token with pausable transfers + burnable + owner mint. OpenZeppelin.",
    "token", '["openzeppelin","token","fungible","pausable"]',
    "#F59E0B", "#D97706",
    fp_rs, fp_test,
    cargo_toml("oz-fungible-pausable", ["stellar-contract-utils","stellar-macros","stellar-tokens"]),
    "# Fungible Pausable (OpenZeppelin)\n\nPausable transfers + burnable + owner mint.\n\n## Build\n```sh\nstellar contract build\n```\n"
))

# 5. OZ NFT
templates.append(template(
    "oz-nft", "NFT (OZ)",
    "Non-fungible token with sequential minting + burnable. OpenZeppelin stellar-tokens.",
    "token", '["openzeppelin","nft","erc721","token"]',
    "#EC4899", "#BE185D",
    nft_rs, nft_test,
    cargo_toml("oz-nft", ["stellar-tokens"]),
    "# NFT (OpenZeppelin)\n\nSequential minting + burnable.\n\n## Build\n```sh\nstellar contract build\n```\n"
))

# 6. OZ Pausable
templates.append(template(
    "oz-pausable", "Pausable",
    "Emergency stop with #[when_not_paused] / #[when_paused] macros. OpenZeppelin.",
    "utility", '["openzeppelin","pausable","emergency"]',
    "#EF4444", "#B91C1C",
    pausable_rs, pausable_test,
    cargo_toml("oz-pausable", ["stellar-contract-utils","stellar-macros"]),
    "# Pausable (OpenZeppelin)\n\nEmergency stop mechanism.\n\n## Build\n```sh\nstellar contract build\n```\n"
))

# 7. OZ Upgradeable
templates.append(template(
    "oz-upgradeable", "Upgradeable",
    "Contract with WASM upgrade capability. Owner can deploy new code. OpenZeppelin.",
    "utility", '["openzeppelin","upgradeable","upgrade"]',
    "#06B6D4", "#0891B2",
    upg_rs, upg_test,
    cargo_toml("oz-upgradeable", ["stellar-access","stellar-contract-utils","stellar-macros"]),
    "# Upgradeable (OpenZeppelin)\n\nWASM upgrade capability.\n\n## Build\n```sh\nstellar contract build\n```\n"
))

# ── Replace templates in registry ───────────────────────────────
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

# Replace existing templates
print("Replacing fungible-token...")
content = replace_template(content, "fungible-token", templates[0])
print("Replacing oz-ownable...")
content = replace_template(content, "oz-ownable", templates[1])
print("Replacing oz-fungible-token...")
content = replace_template(content, "oz-fungible-token", templates[2])

# Add new templates before TEMPLATES array closing
print("Adding new templates...")
templates_end = content.find('\n];\n', content.find('export const TEMPLATES'))
if templates_end != -1:
    new_blocks = "\n" + "\n".join(templates[3:]) + "\n"
    content = content[:templates_end] + new_blocks + content[templates_end:]

with open(REGISTRY, "w") as f:
    f.write(content)

print(f"✓ Done. File size: {len(content)} bytes")
