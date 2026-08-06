/**
 * §10 — Project templates.
 *
 * Templates adapted from:
 *   - Official Soroban examples (https://github.com/stellar/soroban-examples)
 *   - OpenZeppelin Stellar wizard outputs (5 configs)
 *
 * Every template ships with:
 *   - Cargo.toml (soroban-sdk pinned version)
 *   - Contract source (src/lib.rs)
 *   - Test scaffold (src/test.rs)
 *   - README.md
 *   - React UI shell (ui/App.tsx) wired via @openzeppelin/adapter-stellar
 *   - .gitignore
 *
 * Templates pin their soroban-sdk version. When upstream example repos
 * change (via the §9.4 update mechanism), affected templates flag with
 * a "template updated — migrate?" flow.
 */

export interface TemplateFile {
  path: string;
  content: string;
  language: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Category for grouping in the gallery */
  category: "basic" | "token" | "defi" | "governance" | "utility";
  /** OZ wizard config this template replicates (if any) */
  ozWizardUrl?: string;
  /** Soroban SDK version pinned in Cargo.toml */
  sorobanSdkVersion: string;
  /** Preview gradient (used in template card visual) */
  preview: { from: string; to: string };
  /** Files to scaffold when this template is selected */
  files: TemplateFile[];
  /** Tags for search */
  tags: string[];
}

const RUST_PRELUDE = `#![no_std]\n\n`;
const SOROBAN_SDK_V = "22.0.0";

const COMMON_CARGO = (name: string, sdkV: string) => `[package]
name = "${name}"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
soroban-sdk = "${sdkV}"

[dev_dependencies]
soroban-sdk = { version = "${sdkV}", features = ["testutils"] }

[profile.release]
opt-level = "z"

debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
`;

const COMMON_GITIGNORE = `# Rust
/target
**/*.rs.bk

# Soroban
*.wasm
.soroban/

# Editor
.vscode/
.idea/

# Env
.env
.env.local
`;

// ============================================================
// Templates
// ============================================================

export const TEMPLATES: Template[] = [
  // ----- Basic -----
  {
    id: "hello-world",
    name: "Hello World",
    description: "Minimal contract with instance storage and a greet function. The canonical starter.",
    category: "basic",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#4F8C8C", to: "#2C5757" },
    tags: ["beginner", "storage", "string"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: RUST_PRELUDE + `use soroban_sdk::{contract, contractimpl, Env, String, Vec};

#[contract]
pub struct HelloWorld;

#[contractimpl]
impl HelloWorld {
    pub fn __constructor(env: Env) {
        let default = String::from_str(&env, "Hello");
        env.storage().instance().set(&GREETING_KEY, &default);
    }

    pub fn set_greeting(env: Env, greeting: String) -> String {
        env.storage().instance().set(&GREETING_KEY, &greeting);
        greeting
    }

    pub fn get_greeting(env: Env) -> String {
        env.storage()
            .instance()
            .get(&GREETING_KEY)
            .unwrap_or_else(|| String::from_str(&env, "Hello"))
    }

    pub fn greet(env: Env, name: String) -> String {
        let g = Self::get_greeting(env.clone());
        if name.is_empty() { return g; }
        let mut parts: Vec<String> = vec![&env, g, String::from_str(&env, ", "), name, String::from_str(&env, "!")];
        parts.concat(&env)
    }
}

const GREETING_KEY: &str = "Greeting";
`,
      },
      {
        path: "src/test.rs",
        language: "rust",
        content: `#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_default_greeting() {
        let env = Env::default();
        let id = env.register(HelloWorld, ());
        let client = HelloWorldClient::new(&env, &id);
        assert_eq!(client.get_greeting(), String::from_str(&env, "Hello"));
    }

    #[test]
    fn test_personalized_greet() {
        let env = Env::default();
        let id = env.register(HelloWorld, ());
        let client = HelloWorldClient::new(&env, &id);
        let r = client.greet(&String::from_str(&env, "Soroban"));
        assert_eq!(r, String::from_str(&env, "Hello, Soroban!"));
    }
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: COMMON_CARGO("hello-world", SOROBAN_SDK_V),
      },
      {
        path: "ui/App.tsx",
        language: "typescript",
        content: UI_SHELL("HelloWorld", "greet"),
      },
      {
        path: "README.md",
        language: "markdown",
        content: "# Hello World\n\nMinimal Soroban contract with instance storage.\n\n## Build\n\n```sh\nsoroban contract build\n```\n\n## Test\n\n```sh\ncargo test\n```\n",
      },
      { path: ".gitignore", language: "plaintext", content: COMMON_GITIGNORE },
    ],
  },

  // ----- Counter -----
  {
    id: "counter",
    name: "Counter",
    description: "Persistent counter contract with increment/decrement/reset. Shows instance storage and arithmetic.",
    category: "basic",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#7B96B3", to: "#4E7A99" },
    tags: ["beginner", "storage", "arithmetic"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: RUST_PRELUDE + `use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Counter;

const COUNTER_KEY: &str = "COUNTER";

#[contractimpl]
impl Counter {
    pub fn __constructor(env: Env) {
        env.storage().instance().set(&COUNTER_KEY, &0i128);
    }

    pub fn increment(env: Env) -> i128 {
        let current: i128 = env.storage().instance().get(&COUNTER_KEY).unwrap_or(0);
        let new = current.checked_add(1).expect("overflow");
        env.storage().instance().set(&COUNTER_KEY, &new);
        new
    }

    pub fn decrement(env: Env) -> i128 {
        let current: i128 = env.storage().instance().get(&COUNTER_KEY).unwrap_or(0);
        let new = current.checked_sub(1).expect("overflow");
        env.storage().instance().set(&COUNTER_KEY, &new);
        new
    }

    pub fn reset(env: Env) {
        env.storage().instance().set(&COUNTER_KEY, &0i128);
    }

    pub fn get_value(env: Env) -> i128 {
        env.storage().instance().get(&COUNTER_KEY).unwrap_or(0)
    }
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: COMMON_CARGO("counter", SOROBAN_SDK_V),
      },
      {
        path: "ui/App.tsx",
        language: "typescript",
        content: UI_SHELL("Counter", "get_value"),
      },
      { path: ".gitignore", language: "plaintext", content: COMMON_GITIGNORE },
      {
        path: "README.md",
        language: "markdown",
        content: "# Counter\n\nPersistent counter contract.\n",
      },
    ],
  },

  // ----- Fungible Token (OZ wizard: fungible) -----
  {
    id: "fungible-token",
    name: "Fungible Token",
    description: "ERC-20-style fungible token. Replicates the OpenZeppelin Stellar wizard 'fungible' configuration.",
    category: "token",
    ozWizardUrl: "https://wizard.openzeppelin.com/stellar#fungible",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#C9A66B", to: "#9C7B3B" },
    tags: ["token", "erc20", "openzeppelin"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: RUST_PRELUDE + `use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol};

#[contracttype]
pub enum DataKey {
    TotalSupply,
    Balance(Address),
    Allowance(Address, Address),
}

#[contract]
pub struct FungibleToken;

const NAME: &str = "MyToken";
const SYMBOL: &str = "MTK";
const DECIMALS: u32 = 7;
const INITIAL_SUPPLY: i128 = 1_000_000_0000000; // 1M with 7 decimals

#[contractimpl]
impl FungibleToken {
    pub fn __constructor(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::TotalSupply, &INITIAL_SUPPLY);
        env.storage().instance().set(&DataKey::Balance(admin.clone()), &INITIAL_SUPPLY);
    }

    pub fn name(_env: Env) -> String { String::from_str(&_env, NAME) }
    pub fn symbol(_env: Env) -> String { String::from_str(&_env, SYMBOL) }
    pub fn decimals(_env: Env) -> u32 { DECIMALS }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn balance_of(env: Env, account: Address) -> i128 {
        env.storage().instance().get(&DataKey::Balance(account)).unwrap_or(0)
    }

    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        env.storage().instance().get(&DataKey::Allowance(owner, spender)).unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let from_balance = Self::balance_of(env.clone(), from.clone());
        let to_balance = Self::balance_of(env.clone(), to.clone());
        assert!(from_balance >= amount, "insufficient balance");
        env.storage().instance().set(&DataKey::Balance(from.clone()), &(from_balance - amount));
        env.storage().instance().set(&DataKey::Balance(to.clone()), &(to_balance + amount));
    }

    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128) {
        owner.require_auth();
        env.storage().instance().set(&DataKey::Allowance(owner, spender), &amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        let allowance = Self::allowance(env.clone(), from.clone(), spender.clone());
        assert!(allowance >= amount, "insufficient allowance");
        let from_balance = Self::balance_of(env.clone(), from.clone());
        let to_balance = Self::balance_of(env.clone(), to.clone());
        assert!(from_balance >= amount, "insufficient balance");
        env.storage().instance().set(&DataKey::Allowance(from.clone(), spender.clone()), &(allowance - amount));
        env.storage().instance().set(&DataKey::Balance(from.clone()), &(from_balance - amount));
        env.storage().instance().set(&DataKey::Balance(to.clone()), &(to_balance + amount));
    }
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: COMMON_CARGO("fungible-token", SOROBAN_SDK_V),
      },
      {
        path: "ui/App.tsx",
        language: "typescript",
        content: UI_SHELL("FungibleToken", "total_supply"),
      },
      { path: ".gitignore", language: "plaintext", content: COMMON_GITIGNORE },
      {
        path: "README.md",
        language: "markdown",
        content: "# Fungible Token\n\nERC-20-style fungible token for Soroban.\n\nReplicates [OZ Stellar wizard — fungible](https://wizard.openzeppelin.com/stellar#fungible).\n",
      },
    ],
  },

  // ----- Non-Fungible Token (OZ wizard: nonfungible) -----
  {
    id: "non-fungible-token",
    name: "Non-Fungible Token",
    description: "ERC-721-style NFT with mint, transfer, and ownership tracking. Replicates OZ wizard 'nonfungible'.",
    category: "token",
    ozWizardUrl: "https://wizard.openzeppelin.com/stellar#nonfungible",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#A88FB3", to: "#7B5C8C" },
    tags: ["nft", "erc721", "openzeppelin"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: RUST_PRELUDE + `use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map};

#[contracttype]
pub enum DataKey {
    TotalSupply,
    Owner(u32),
    TokenApproval(u32),
    OperatorApproval(Address, Address),
}

#[contract]
pub struct NonFungibleToken;

#[contractimpl]
impl NonFungibleToken {
    pub fn __constructor(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::TotalSupply, &0u32);
    }

    pub fn mint(env: Env, to: Address) -> u32 {
        let admin: Address = env.storage().instance().get(&"ADMIN").expect("no admin");
        admin.require_auth();
        let total: u32 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        let new_id = total + 1;
        env.storage().instance().set(&DataKey::TotalSupply, &new_id);
        env.storage().instance().set(&DataKey::Owner(new_id), &to);
        new_id
    }

    pub fn owner_of(env: Env, token_id: u32) -> Address {
        env.storage().instance().get(&DataKey::Owner(token_id)).expect("token does not exist")
    }

    pub fn transfer(env: Env, from: Address, to: Address, token_id: u32) {
        from.require_auth();
        let current_owner = Self::owner_of(env.clone(), token_id);
        assert!(current_owner == from, "not owner");
        env.storage().instance().set(&DataKey::Owner(token_id), &to);
    }

    pub fn total_supply(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: COMMON_CARGO("non-fungible-token", SOROBAN_SDK_V),
      },
      {
        path: "ui/App.tsx",
        language: "typescript",
        content: UI_SHELL("NonFungibleToken", "total_supply"),
      },
      { path: ".gitignore", language: "plaintext", content: COMMON_GITIGNORE },
      {
        path: "README.md",
        language: "markdown",
        content: "# Non-Fungible Token\n\nERC-721-style NFT for Soroban.\n\nReplicates [OZ Stellar wizard — nonfungible](https://wizard.openzeppelin.com/stellar#nonfungible).\n",
      },
    ],
  },

  // ----- Stablecoin (OZ wizard: stablecoin) -----
  {
    id: "stablecoin",
    name: "Stablecoin",
    description: "Fungible token with mint/burn controlled by an admin. Replicates OZ wizard 'stablecoin'.",
    category: "defi",
    ozWizardUrl: "https://wizard.openzeppelin.com/stellar#stablecoin",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#6FA885", to: "#4E8466" },
    tags: ["stablecoin", "defi", "mintable", "burnable", "openzeppelin"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: RUST_PRELUDE + `use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    TotalSupply,
    Balance(Address),
    Admin,
}

#[contract]
pub struct Stablecoin;

const DECIMALS: u32 = 6; // 6 decimals for USD-pegged stablecoin

#[contractimpl]
impl Stablecoin {
    pub fn __constructor(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
    }

    pub fn decimals(_env: Env) -> u32 { DECIMALS }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn balance_of(env: Env, account: Address) -> i128 {
        env.storage().instance().get(&DataKey::Balance(account)).unwrap_or(0)
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("no admin");
        admin.require_auth();
        let balance = Self::balance_of(env.clone(), to.clone());
        env.storage().instance().set(&DataKey::Balance(to), &(balance + amount));
        let supply = Self::total_supply(env.clone());
        env.storage().instance().set(&DataKey::TotalSupply, &(supply + amount));
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let balance = Self::balance_of(env.clone(), from.clone());
        assert!(balance >= amount, "insufficient balance to burn");
        env.storage().instance().set(&DataKey::Balance(from), &(balance - amount));
        let supply = Self::total_supply(env.clone());
        env.storage().instance().set(&DataKey::TotalSupply, &(supply - amount));
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let from_balance = Self::balance_of(env.clone(), from.clone());
        let to_balance = Self::balance_of(env.clone(), to.clone());
        assert!(from_balance >= amount, "insufficient balance");
        env.storage().instance().set(&DataKey::Balance(from), &(from_balance - amount));
        env.storage().instance().set(&DataKey::Balance(to), &(to_balance + amount));
    }
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: COMMON_CARGO("stablecoin", SOROBAN_SDK_V),
      },
      {
        path: "ui/App.tsx",
        language: "typescript",
        content: UI_SHELL("Stablecoin", "total_supply"),
      },
      { path: ".gitignore", language: "plaintext", content: COMMON_GITIGNORE },
      {
        path: "README.md",
        language: "markdown",
        content: "# Stablecoin\n\nMintable/burnable stablecoin for Soroban.\n\nReplicates [OZ Stellar wizard — stablecoin](https://wizard.openzeppelin.com/stellar#stablecoin).\n",
      },
    ],
  },

  // ----- Vault (OZ wizard: vault) -----
  {
    id: "vault",
    name: "Vault",
    description: "Token vault with deposit/withdraw and share accounting. Replicates OZ wizard 'vault'.",
    category: "defi",
    ozWizardUrl: "https://wizard.openzeppelin.com/stellar#vault",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#D29464", to: "#A66B40" },
    tags: ["vault", "defi", "yield", "openzeppelin"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: RUST_PRELUDE + `use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    TotalAssets,
    TotalShares,
    Balance(Address),
}

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn __constructor(env: Env) {
        env.storage().instance().set(&DataKey::TotalAssets, &0i128);
        env.storage().instance().set(&DataKey::TotalShares, &0i128);
    }

    pub fn total_assets(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalAssets).unwrap_or(0)
    }

    pub fn total_shares(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0)
    }

    pub fn balance_of(env: Env, account: Address) -> i128 {
        env.storage().instance().get(&DataKey::Balance(account)).unwrap_or(0)
    }

    pub fn deposit(env: Env, depositor: Address, amount: i128) -> i128 {
        depositor.require_auth();
        let total_assets = Self::total_assets(env.clone());
        let total_shares = Self::total_shares(env.clone());
        let shares = if total_shares == 0 {
            amount
        } else {
            (amount * total_shares) / total_assets
        };
        assert!(shares > 0, "zero shares");
        let new_balance = Self::balance_of(env.clone(), depositor.clone()) + shares;
        env.storage().instance().set(&DataKey::Balance(depositor), &new_balance);
        env.storage().instance().set(&DataKey::TotalShares, &(total_shares + shares));
        env.storage().instance().set(&DataKey::TotalAssets, &(total_assets + amount));
        shares
    }

    pub fn withdraw(env: Env, withdrawer: Address, shares: i128) -> i128 {
        withdrawer.require_auth();
        let balance = Self::balance_of(env.clone(), withdrawer.clone());
        assert!(balance >= shares, "insufficient shares");
        let total_assets = Self::total_assets(env.clone());
        let total_shares = Self::total_shares(env.clone());
        let amount = (shares * total_assets) / total_shares;
        env.storage().instance().set(&DataKey::Balance(withdrawer), &(balance - shares));
        env.storage().instance().set(&DataKey::TotalShares, &(total_shares - shares));
        env.storage().instance().set(&DataKey::TotalAssets, &(total_assets - amount));
        amount
    }
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: COMMON_CARGO("vault", SOROBAN_SDK_V),
      },
      {
        path: "ui/App.tsx",
        language: "typescript",
        content: UI_SHELL("Vault", "total_assets"),
      },
      { path: ".gitignore", language: "plaintext", content: COMMON_GITIGNORE },
      {
        path: "README.md",
        language: "markdown",
        content: "# Vault\n\nToken vault with share-based accounting.\n\nReplicates [OZ Stellar wizard — vault](https://wizard.openzeppelin.com/stellar#vault).\n",
      },
    ],
  },

  // ----- Governor (OZ wizard: governor) -----
  {
    id: "governor",
    name: "Governor",
    description: "On-chain governance with propose/vote/execute. Replicates OZ wizard 'governor'.",
    category: "governance",
    ozWizardUrl: "https://wizard.openzeppelin.com/stellar#governor",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#9A88A8", to: "#6A6285" },
    tags: ["governance", "dao", "voting", "openzeppelin"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: RUST_PRELUDE + `use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map};

#[contracttype]
pub struct Proposal {
    pub proposer: Address,
    pub for_votes: i128,
    pub against_votes: i128,
    pub executed: bool,
}

#[contracttype]
pub enum DataKey {
    Proposal(u32),
    ProposalCount,
    VotingPower(Address),
}

#[contract]
pub struct Governor;

const VOTING_PERIOD: u64 = 1000; // ledgers

#[contractimpl]
impl Governor {
    pub fn __constructor(env: Env) {
        env.storage().instance().set(&DataKey::ProposalCount, &0u32);
    }

    pub fn propose(env: Env, proposer: Address) -> u32 {
        proposer.require_auth();
        let count: u32 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let new_id = count + 1;
        let proposal = Proposal {
            proposer,
            for_votes: 0,
            against_votes: 0,
            executed: false,
        };
        env.storage().instance().set(&DataKey::Proposal(new_id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &new_id);
        new_id
    }

    pub fn vote(env: Env, voter: Address, proposal_id: u32, support: bool) {
        voter.require_auth();
        let mut proposal: Proposal = env.storage().instance().get(&DataKey::Proposal(proposal_id)).expect("no proposal");
        let voting_power: i128 = env.storage().instance().get(&DataKey::VotingPower(voter.clone())).unwrap_or(0);
        assert!(voting_power > 0, "no voting power");
        if support {
            proposal.for_votes += voting_power;
        } else {
            proposal.against_votes += voting_power;
        }
        env.storage().instance().set(&DataKey::Proposal(proposal_id), &proposal);
    }

    pub fn execute(env: Env, proposal_id: u32) -> bool {
        let mut proposal: Proposal = env.storage().instance().get(&DataKey::Proposal(proposal_id)).expect("no proposal");
        assert!(!proposal.executed, "already executed");
        assert!(proposal.for_votes > proposal.against_votes, "proposal rejected");
        proposal.executed = true;
        env.storage().instance().set(&DataKey::Proposal(proposal_id), &proposal);
        true
    }

    pub fn delegate_voting_power(env: Env, to: Address, amount: i128) {
        to.require_auth();
        env.storage().instance().set(&DataKey::VotingPower(to), &amount);
    }
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: COMMON_CARGO("governor", SOROBAN_SDK_V),
      },
      {
        path: "ui/App.tsx",
        language: "typescript",
        content: UI_SHELL("Governor", "propose"),
      },
      { path: ".gitignore", language: "plaintext", content: COMMON_GITIGNORE },
      {
        path: "README.md",
        language: "markdown",
        content: "# Governor\n\nOn-chain governance contract.\n\nReplicates [OZ Stellar wizard — governor](https://wizard.openzeppelin.com/stellar#governor).\n",
      },
    ],
  },

  // ----- Blank -----
  {
    id: "blank",
    name: "Blank Project",
    description: "Empty Soroban workspace. Just Cargo.toml + an empty lib.rs to start from scratch.",
    category: "basic",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#6E7178", to: "#4A4D54" },
    tags: ["blank", "starter"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: RUST_PRELUDE + `use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn __constructor(_env: Env) {
        // Initialize storage here
    }

    pub fn hello(env: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&env, "Hello, Soroban!")
    }
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: COMMON_CARGO("my-contract", SOROBAN_SDK_V),
      },
      { path: ".gitignore", language: "plaintext", content: COMMON_GITIGNORE },
      {
        path: "README.md",
        language: "markdown",
        content: "# My Soroban Contract\n\nDescribe your contract here.\n",
      },
    ],
  },
];

function UI_SHELL(contractName: string, primaryFn: string): string {
  return `import { useEffect, useState } from "react";
// import { deploy, invoke } from "@openzeppelin/adapter-stellar";

/**
 * UI for the ${contractName} contract.
 * Auto-generated by Soroban.Build from the contract spec.
 *
 * Wire up real interactions once the contract is deployed:
 *   const contractId = await deploy("${contractName}");
 *   const result = await invoke(contractId, "${primaryFn}");
 */
export default function ${contractName}UI({ contractId }: { contractId: string }) {
  const [output, setOutput] = useState<string>("");

  async function handleCall() {
    // const result = await invoke(contractId, "${primaryFn}");
    // setOutput(result);
    setOutput("(wire @openzeppelin/adapter-stellar to call ${primaryFn})");
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1 style={{ margin: "0 0 12px" }}>${contractName}</h1>
      <p style={{ color: "#666", marginBottom: 16 }}>Contract ID: {contractId}</p>
      <button onClick={handleCall}>Call ${primaryFn}()</button>
      {output && <pre style={{ marginTop: 12, padding: 12, background: "#f4f4f4" }}>{output}</pre>}
    </main>
  );
}
`;
}

export function getTemplateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export const TEMPLATE_CATEGORIES: { id: Template["category"]; label: string }[] = [
  { id: "basic", label: "Basic" },
  { id: "token", label: "Tokens" },
  { id: "defi", label: "DeFi" },
  { id: "governance", label: "Governance" },
  { id: "utility", label: "Utility" },
];
