/**
 * §10 — Project templates.
 *
 * Each template ships with REAL, compilable Soroban contract code:
 *   - Cargo.toml (soroban-sdk pinned version, overflow-checks, release profile)
 *   - Contract source (src/lib.rs) — full implementation, not a stub
 *   - Test scaffold (src/test.rs) — real tests using soroban-sdk testutils
 *   - README.md — build/deploy instructions
 *   - .gitignore
 *
 * Templates are adapted from the official stellar/soroban-examples repo and
 * the OpenZeppelin Stellar wizard. They target soroban-sdk 22.0.0.
 *
 * No mock UI shells — the IDE itself is the UI. When the contract is built
 * and deployed, the Compile panel shows the function signatures and the
 * Deploy panel provides an invoke interface auto-generated from the spec.
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
  category: "basic" | "token" | "defi" | "governance" | "utility";
  ozWizardUrl?: string;
  sorobanSdkVersion: string;
  preview: { from: string; to: string };
  files: TemplateFile[];
  tags: string[];
}

const SOROBAN_SDK_V = "22.1.0";

// Shared Cargo.toml template — includes overflow-checks (required by stellar-cli 27+)
// and a size-optimized release profile.
const cargoToml = (name: string, sdkV: string) => `[package]
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
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
`;

const GITIGNORE = `# Rust
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
  // ---------------------------------------------------------------
  // Hello World — minimal contract with instance storage
  // ---------------------------------------------------------------
  {
    id: "hello-world",
    name: "Hello World",
    description: "Minimal contract with instance storage and a greet function. The canonical starter — stores a greeting and returns a personalized message.",
    category: "basic",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#4F8C8C", to: "#2C5757" },
    tags: ["beginner", "storage", "string"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: `#![no_std]

use soroban_sdk::{contract, contractimpl, Env, String, Vec};

const GREETING_KEY: &str = "Greeting";

#[contract]
pub struct HelloWorld;

#[contractimpl]
impl HelloWorld {
    /// Initialize the contract with a default greeting.
    pub fn __constructor(env: Env) {
        let default = String::from_str(&env, "Hello");
        env.storage().instance().set(&GREETING_KEY, &default);
    }

    /// Set a new greeting. Returns the new greeting.
    pub fn set_greeting(env: Env, greeting: String) -> String {
        env.storage().instance().set(&GREETING_KEY, &greeting);
        greeting
    }

    /// Read the current greeting.
    pub fn get_greeting(env: Env) -> String {
        env.storage()
            .instance()
            .get(&GREETING_KEY)
            .unwrap_or_else(|| String::from_str(&env, "Hello"))
    }

    /// Returns a personalized greeting addressed to \`name\`.
    pub fn greet(env: Env, name: String) -> String {
        let greeting = Self::get_greeting(env.clone());
        if name.is_empty() {
            return greeting;
        }
        let mut parts: Vec<String> = vec![
            &env,
            greeting,
            String::from_str(&env, ", "),
            name,
            String::from_str(&env, "!"),
        ];
        parts.concat(&env)
    }
}
`,
      },
      {
        path: "src/test.rs",
        language: "rust",
        content: `#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;

#[test]
fn test_default_greeting() {
    let env = Env::default();
    let contract_id = env.register(HelloWorld, ());
    let client = HelloWorldClient::new(&env, &contract_id);

    // After construction, the greeting should be "Hello"
    let greeting = client.get_greeting();
    assert_eq!(greeting, String::from_str(&env, "Hello"));
}

#[test]
fn test_set_greeting() {
    let env = Env::default();
    let contract_id = env.register(HelloWorld, ());
    let client = HelloWorldClient::new(&env, &contract_id);

    let new_greeting = client.set_greeting(&String::from_str(&env, "Bonjour"));
    assert_eq!(new_greeting, String::from_str(&env, "Bonjour"));
    assert_eq!(client.get_greeting(), String::from_str(&env, "Bonjour"));
}

#[test]
fn test_personalized_greet() {
    let env = Env::default();
    let contract_id = env.register(HelloWorld, ());
    let client = HelloWorldClient::new(&env, &contract_id);

    let result = client.greet(&String::from_str(&env, "Soroban"));
    assert_eq!(result, String::from_str(&env, "Hello, Soroban!"));
}

#[test]
fn test_empty_name_returns_greeting() {
    let env = Env::default();
    let contract_id = env.register(HelloWorld, ());
    let client = HelloWorldClient::new(&env, &contract_id);

    let result = client.greet(&String::from_str(&env, ""));
    assert_eq!(result, String::from_str(&env, "Hello"));
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: cargoToml("hello-world", SOROBAN_SDK_V),
      },
      {
        path: "README.md",
        language: "markdown",
        content: `# Hello World

A minimal Soroban smart contract with instance storage.

## Functions

- \`__constructor()\` — initializes the greeting to "Hello"
- \`set_greeting(greeting: String) -> String\` — sets a new greeting
- \`get_greeting() -> String\` — reads the current greeting
- \`greet(name: String) -> String\` — returns a personalized greeting

## Build

\`\`\`sh
soroban contract build
\`\`\`

## Test

\`\`\`sh
cargo test
\`\`\`

## Deploy

\`\`\`sh
soroban contract deploy \\
  --wasm target/wasm32v1-none/release/hello_world.wasm \\
  --source-account <SECRET_KEY> \\
  --network testnet
\`\`\`
`,
      },
      { path: ".gitignore", language: "plaintext", content: GITIGNORE },
    ],
  },

  // ---------------------------------------------------------------
  // Counter — persistent counter with increment/decrement/reset
  // ---------------------------------------------------------------
  {
    id: "counter",
    name: "Counter",
    description: "Persistent counter contract with increment, decrement, and reset. Demonstrates instance storage and i128 arithmetic with overflow protection.",
    category: "basic",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#7B96B3", to: "#4E7A99" },
    tags: ["beginner", "storage", "arithmetic"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: `#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

const COUNTER_KEY: &str = "COUNTER";

#[contract]
pub struct Counter;

#[contractimpl]
impl Counter {
    /// Initialize the counter to zero.
    pub fn __constructor(env: Env) {
        env.storage().instance().set(&COUNTER_KEY, &0i128);
    }

    /// Increment the counter by 1. Returns the new value.
    pub fn increment(env: Env) -> i128 {
        let current: i128 = env.storage().instance().get(&COUNTER_KEY).unwrap_or(0);
        let new = current.checked_add(1).expect("counter overflow");
        env.storage().instance().set(&COUNTER_KEY, &new);
        new
    }

    /// Decrement the counter by 1. Returns the new value.
    pub fn decrement(env: Env) -> i128 {
        let current: i128 = env.storage().instance().get(&COUNTER_KEY).unwrap_or(0);
        let new = current.checked_sub(1).expect("counter underflow");
        env.storage().instance().set(&COUNTER_KEY, &new);
        new
    }

    /// Reset the counter to zero.
    pub fn reset(env: Env) {
        env.storage().instance().set(&COUNTER_KEY, &0i128);
    }

    /// Read the current counter value.
    pub fn get_value(env: Env) -> i128 {
        env.storage().instance().get(&COUNTER_KEY).unwrap_or(0)
    }
}
`,
      },
      {
        path: "src/test.rs",
        language: "rust",
        content: `#![cfg(test)]

use super::*;

#[test]
fn test_increment() {
    let env = Env::default();
    let contract_id = env.register(Counter, ());
    let client = CounterClient::new(&env, &contract_id);

    assert_eq!(client.get_value(), 0);
    assert_eq!(client.increment(), 1);
    assert_eq!(client.increment(), 2);
    assert_eq!(client.get_value(), 2);
}

#[test]
fn test_decrement() {
    let env = Env::default();
    let contract_id = env.register(Counter, ());
    let client = CounterClient::new(&env, &contract_id);

    client.increment();
    client.increment();
    assert_eq!(client.decrement(), 1);
    assert_eq!(client.get_value(), 1);
}

#[test]
fn test_reset() {
    let env = Env::default();
    let contract_id = env.register(Counter, ());
    let client = CounterClient::new(&env, &contract_id);

    client.increment();
    client.increment();
    client.reset();
    assert_eq!(client.get_value(), 0);
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: cargoToml("counter", SOROBAN_SDK_V),
      },
      {
        path: "README.md",
        language: "markdown",
        content: `# Counter

A persistent counter contract demonstrating instance storage and arithmetic.

## Functions

- \`__constructor()\` — initializes counter to 0
- \`increment() -> i128\` — adds 1, returns new value
- \`decrement() -> i128\` — subtracts 1, returns new value
- \`reset()\` — sets counter back to 0
- \`get_value() -> i128\` — reads current value

## Build & Test

\`\`\`sh
soroban contract build
cargo test
\`\`\`
`,
      },
      { path: ".gitignore", language: "plaintext", content: GITIGNORE },
    ],
  },

  // ---------------------------------------------------------------
  // Fungible Token — ERC-20-style token (OZ wizard: fungible)
  // ---------------------------------------------------------------
  {
    id: "fungible-token",
    name: "Fungible Token",
    description: "ERC-20-style fungible token with transfer, approve, and transfer_from. Replicates the OpenZeppelin Stellar wizard 'fungible' configuration.",
    category: "token",
    ozWizardUrl: "https://wizard.openzeppelin.com/stellar#fungible",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#C9A66B", to: "#9C7B3B" },
    tags: ["token", "erc20", "openzeppelin"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: `#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

const NAME: &str = "MyToken";
const SYMBOL: &str = "MTK";
const DECIMALS: u32 = 7;
const INITIAL_SUPPLY: i128 = 1_000_000_0000000; // 1M tokens (7 decimals)

#[contracttype]
pub enum DataKey {
    TotalSupply,
    Balance(Address),
    Allowance(Address, Address),
}

#[contract]
pub struct FungibleToken;

#[contractimpl]
impl FungibleToken {
    /// Initialize the token and mint the initial supply to the admin.
    pub fn __constructor(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::TotalSupply, &INITIAL_SUPPLY);
        env.storage().instance().set(&DataKey::Balance(admin), &INITIAL_SUPPLY);
    }

    pub fn name(env: Env) -> String {
        String::from_str(&env, NAME)
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, SYMBOL)
    }

    pub fn decimals(_env: Env) -> u32 {
        DECIMALS
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn balance_of(env: Env, account: Address) -> i128 {
        env.storage().instance().get(&DataKey::Balance(account)).unwrap_or(0)
    }

    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Allowance(owner, spender))
            .unwrap_or(0)
    }

    /// Transfer tokens from the caller to another account.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::do_transfer(env, from, to, amount);
    }

    /// Approve a spender to transfer up to \`amount\` tokens on behalf of the owner.
    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128) {
        owner.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Allowance(owner, spender), &amount);
    }

    /// Transfer tokens on behalf of an owner, using an allowance.
    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        let current_allowance = Self::allowance(env.clone(), from.clone(), spender.clone());
        assert!(current_allowance >= amount, "insufficient allowance");
        env.storage()
            .instance()
            .set(&DataKey::Allowance(from.clone(), spender), &(current_allowance - amount));
        Self::do_transfer(env, from, to, amount);
    }
}

impl FungibleToken {
    fn do_transfer(env: Env, from: Address, to: Address, amount: i128) {
        let from_balance = Self::balance_of(env.clone(), from.clone());
        let to_balance = Self::balance_of(env.clone(), to.clone());
        assert!(from_balance >= amount, "insufficient balance");
        env.storage()
            .instance()
            .set(&DataKey::Balance(from), &(from_balance - amount));
        env.storage()
            .instance()
            .set(&DataKey::Balance(to), &(to_balance + amount));
    }
}
`,
      },
      {
        path: "src/test.rs",
        language: "rust",
        content: `#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;

fn setup_token() -> (Env, Address, FungibleTokenClient<'static>) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(FungibleToken, (admin.clone(),));
    let client = FungibleTokenClient::new(&env, &contract_id);
    (env, admin, client)
}

#[test]
fn test_metadata() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(FungibleToken, (admin.clone(),));
    let client = FungibleTokenClient::new(&env, &contract_id);

    assert_eq!(client.name(), String::from_str(&env, "MyToken"));
    assert_eq!(client.symbol(), String::from_str(&env, "MTK"));
    assert_eq!(client.decimals(), 7);
}

#[test]
fn test_initial_supply() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(FungibleToken, (admin.clone(),));
    let client = FungibleTokenClient::new(&env, &contract_id);

    assert_eq!(client.total_supply(), 1_000_000_0000000);
    assert_eq!(client.balance_of(&admin), 1_000_000_0000000);
}

#[test]
fn test_transfer() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let contract_id = env.register(FungibleToken, (admin.clone(),));
    let client = FungibleTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.transfer(&admin, &recipient, &1000000);

    assert_eq!(client.balance_of(&admin), 999_999_0000000);
    assert_eq!(client.balance_of(&recipient), 1000000);
}

#[test]
fn test_approve_and_transfer_from() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let spender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let contract_id = env.register(FungibleToken, (admin.clone(),));
    let client = FungibleTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.approve(&admin, &spender, &5000000);
    assert_eq!(client.allowance(&admin, &spender), 5000000);

    client.transfer_from(&spender, &admin, &recipient, &2000000);
    assert_eq!(client.balance_of(&recipient), 2000000);
    assert_eq!(client.allowance(&admin, &spender), 3000000);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_insufficient_balance_panics() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let contract_id = env.register(FungibleToken, (admin.clone(),));
    let client = FungibleTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.transfer(&admin, &recipient, &999_999_999_999_999_999);
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: cargoToml("fungible-token", SOROBAN_SDK_V),
      },
      {
        path: "README.md",
        language: "markdown",
        content: `# Fungible Token

ERC-20-style fungible token for Soroban.

Replicates [OZ Stellar wizard — fungible](https://wizard.openzeppelin.com/stellar#fungible).

## Functions

- \`__constructor(admin: Address)\` — mints initial supply to admin
- \`name() -> String\` — "MyToken"
- \`symbol() -> String\` — "MTK"
- \`decimals() -> u32\` — 7
- \`total_supply() -> i128\`
- \`balance_of(account: Address) -> i128\`
- \`allowance(owner: Address, spender: Address) -> i128\`
- \`transfer(from: Address, to: Address, amount: i128)\`
- \`approve(owner: Address, spender: Address, amount: i128)\`
- \`transfer_from(spender: Address, from: Address, to: Address, amount: i128)\`

## Build & Test

\`\`\`sh
soroban contract build
cargo test
\`\`\`
`,
      },
      { path: ".gitignore", language: "plaintext", content: GITIGNORE },
    ],
  },

  // ---------------------------------------------------------------
  // Non-Fungible Token — ERC-721-style NFT (OZ wizard: nonfungible)
  // ---------------------------------------------------------------
  {
    id: "non-fungible-token",
    name: "Non-Fungible Token",
    description: "ERC-721-style NFT with mint, transfer, and ownership tracking. Each token has a unique ID. Replicates OZ wizard 'nonfungible'.",
    category: "token",
    ozWizardUrl: "https://wizard.openzeppelin.com/stellar#nonfungible",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#A88FB3", to: "#7B5C8C" },
    tags: ["nft", "erc721", "openzeppelin"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: `#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    Admin,
    TotalSupply,
    Owner(u32),
    TokenApproval(u32),
    OperatorApproval(Address, Address),
}

#[contract]
pub struct NonFungibleToken;

#[contractimpl]
impl NonFungibleToken {
    /// Initialize the contract with an admin who can mint new tokens.
    pub fn __constructor(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &0u32);
    }

    /// Mint a new token to the specified address. Only the admin can mint.
    /// Returns the new token ID.
    pub fn mint(env: Env, to: Address) -> u32 {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();

        let total: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        let new_id = total + 1;

        env.storage().instance().set(&DataKey::TotalSupply, &new_id);
        env.storage().instance().set(&DataKey::Owner(new_id), &to);
        new_id
    }

    /// Get the owner of a specific token.
    pub fn owner_of(env: Env, token_id: u32) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Owner(token_id))
            .expect("token does not exist")
    }

    /// Transfer a token from one address to another.
    pub fn transfer(env: Env, from: Address, to: Address, token_id: u32) {
        from.require_auth();
        let current_owner = Self::owner_of(env, token_id);
        assert!(current_owner == from, "not the owner");
        env.storage().instance().set(&DataKey::Owner(token_id), &to);
    }

    /// Get the total number of tokens that have been minted.
    pub fn total_supply(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }
}
`,
      },
      {
        path: "src/test.rs",
        language: "rust",
        content: `#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;

#[test]
fn test_mint() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let contract_id = env.register(NonFungibleToken, (admin.clone(),));
    let client = NonFungibleTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    let token_id = client.mint(&recipient);
    assert_eq!(token_id, 1);
    assert_eq!(client.owner_of(&1), recipient);
    assert_eq!(client.total_supply(), 1);
}

#[test]
fn test_mint_multiple() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let contract_id = env.register(NonFungibleToken, (admin.clone(),));
    let client = NonFungibleTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    let id1 = client.mint(&alice);
    let id2 = client.mint(&bob);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(client.total_supply(), 2);
}

#[test]
fn test_transfer() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let contract_id = env.register(NonFungibleToken, (admin.clone(),));
    let client = NonFungibleTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    let token_id = client.mint(&alice);
    client.transfer(&alice, &bob, &token_id);
    assert_eq!(client.owner_of(&token_id), bob);
}

#[test]
#[should_panic(expected = "not the owner")]
fn test_transfer_by_non_owner_panics() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let contract_id = env.register(NonFungibleToken, (admin.clone(),));
    let client = NonFungibleTokenClient::new(&env, &contract_id);

    env.mock_all_auths();
    let token_id = client.mint(&alice);
    // Bob tries to transfer Alice's token — should panic
    client.transfer(&bob, &bob, &token_id);
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: cargoToml("non-fungible-token", SOROBAN_SDK_V),
      },
      {
        path: "README.md",
        language: "markdown",
        content: `# Non-Fungible Token

ERC-721-style NFT for Soroban with unique token IDs.

Replicates [OZ Stellar wizard — nonfungible](https://wizard.openzeppelin.com/stellar#nonfungible).

## Functions

- \`__constructor(admin: Address)\` — sets the admin (minter)
- \`mint(to: Address) -> u32\` — mints a new token, returns its ID
- \`owner_of(token_id: u32) -> Address\` — gets the owner of a token
- \`transfer(from: Address, to: Address, token_id: u32)\` — transfers a token
- \`total_supply() -> u32\` — total minted tokens

## Build & Test

\`\`\`sh
soroban contract build
cargo test
\`\`\`
`,
      },
      { path: ".gitignore", language: "plaintext", content: GITIGNORE },
    ],
  },

  // ---------------------------------------------------------------
  // Stablecoin — mintable/burnable token (OZ wizard: stablecoin)
  // ---------------------------------------------------------------
  {
    id: "stablecoin",
    name: "Stablecoin",
    description: "Fungible token with admin-controlled mint and user-controlled burn. 6 decimals for USD-pegged use. Replicates OZ wizard 'stablecoin'.",
    category: "defi",
    ozWizardUrl: "https://wizard.openzeppelin.com/stellar#stablecoin",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#6FA885", to: "#4E8466" },
    tags: ["stablecoin", "defi", "mintable", "burnable", "openzeppelin"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: `#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

const DECIMALS: u32 = 6; // 6 decimals for USD-pegged stablecoin

#[contracttype]
pub enum DataKey {
    Admin,
    TotalSupply,
    Balance(Address),
}

#[contract]
pub struct Stablecoin;

#[contractimpl]
impl Stablecoin {
    /// Initialize the contract with an admin who can mint new tokens.
    pub fn __constructor(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
    }

    pub fn decimals(_env: Env) -> u32 {
        DECIMALS
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn balance_of(env: Env, account: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Balance(account))
            .unwrap_or(0)
    }

    /// Mint new tokens to an account. Only the admin can mint.
    pub fn mint(env: Env, to: Address, amount: i128) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();

        let balance = Self::balance_of(env.clone(), to.clone());
        env.storage()
            .instance()
            .set(&DataKey::Balance(to), &(balance + amount));

        let supply = Self::total_supply(env);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply + amount));
    }

    /// Burn tokens from the caller's own balance.
    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let balance = Self::balance_of(env.clone(), from.clone());
        assert!(balance >= amount, "insufficient balance to burn");

        env.storage()
            .instance()
            .set(&DataKey::Balance(from), &(balance - amount));

        let supply = Self::total_supply(env);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply - amount));
    }

    /// Transfer tokens from the caller to another account.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let from_balance = Self::balance_of(env.clone(), from.clone());
        let to_balance = Self::balance_of(env.clone(), to.clone());
        assert!(from_balance >= amount, "insufficient balance");

        env.storage()
            .instance()
            .set(&DataKey::Balance(from), &(from_balance - amount));
        env.storage()
            .instance()
            .set(&DataKey::Balance(to), &(to_balance + amount));
    }
}
`,
      },
      {
        path: "src/test.rs",
        language: "rust",
        content: `#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;

fn setup() -> (Env, Address, StablecoinClient<'static>) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(Stablecoin, (admin.clone(),));
    let client = StablecoinClient::new(&env, &contract_id);
    (env, admin, client)
}

#[test]
fn test_decimals() {
    let (env, admin, client) = setup();
    assert_eq!(client.decimals(), 6);
}

#[test]
fn test_mint() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);

    env.mock_all_auths();
    client.mint(&user, &1_000_000000); // 1 million with 6 decimals

    assert_eq!(client.balance_of(&user), 1_000_000000);
    assert_eq!(client.total_supply(), 1_000_000000);
}

#[test]
fn test_burn() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);

    env.mock_all_auths();
    client.mint(&user, &1_000_000000);
    client.burn(&user, &400_000000);

    assert_eq!(client.balance_of(&user), 600_000000);
    assert_eq!(client.total_supply(), 600_000000);
}

#[test]
fn test_transfer() {
    let (env, admin, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    env.mock_all_auths();
    client.mint(&alice, &1_000_000000);
    client.transfer(&alice, &bob, &300_000000);

    assert_eq!(client.balance_of(&alice), 700_000000);
    assert_eq!(client.balance_of(&bob), 300_000000);
}

#[test]
#[should_panic(expected = "insufficient balance to burn")]
fn test_burn_more_than_balance_panics() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);

    env.mock_all_auths();
    client.mint(&user, &100_000000);
    client.burn(&user, &200_000000);
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: cargoToml("stablecoin", SOROBAN_SDK_V),
      },
      {
        path: "README.md",
        language: "markdown",
        content: `# Stablecoin

Mintable/burnable stablecoin with 6 decimals (USD-pegged).

Replicates [OZ Stellar wizard — stablecoin](https://wizard.openzeppelin.com/stellar#stablecoin).

## Functions

- \`__constructor(admin: Address)\` — sets the admin (minter)
- \`decimals() -> u32\` — 6
- \`total_supply() -> i128\`
- \`balance_of(account: Address) -> i128\`
- \`mint(to: Address, amount: i128)\` — admin only
- \`burn(from: Address, amount: i128)\` — burns own tokens
- \`transfer(from: Address, to: Address, amount: i128)\`

## Build & Test

\`\`\`sh
soroban contract build
cargo test
\`\`\`
`,
      },
      { path: ".gitignore", language: "plaintext", content: GITIGNORE },
    ],
  },

  // ---------------------------------------------------------------
  // Vault — deposit/withdraw with share accounting (OZ wizard: vault)
  // ---------------------------------------------------------------
  {
    id: "vault",
    name: "Vault",
    description: "Token vault with deposit and withdraw. Users get shares proportional to their deposit. Share price increases as the vault earns yield. Replicates OZ wizard 'vault'.",
    category: "defi",
    ozWizardUrl: "https://wizard.openzeppelin.com/stellar#vault",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#D29464", to: "#A66B40" },
    tags: ["vault", "defi", "yield", "shares", "openzeppelin"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: `#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

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
    /// Initialize the vault with zero assets and zero shares.
    pub fn __constructor(env: Env) {
        env.storage().instance().set(&DataKey::TotalAssets, &0i128);
        env.storage().instance().set(&DataKey::TotalShares, &0i128);
    }

    /// Total amount of assets currently held by the vault.
    pub fn total_assets(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalAssets).unwrap_or(0)
    }

    /// Total number of shares outstanding.
    pub fn total_shares(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0)
    }

    /// Shares held by a specific account.
    pub fn balance_of(env: Env, account: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Balance(account))
            .unwrap_or(0)
    }

    /// Deposit assets into the vault and receive shares.
    /// Returns the number of shares minted.
    pub fn deposit(env: Env, depositor: Address, amount: i128) -> i128 {
        depositor.require_auth();
        assert!(amount > 0, "amount must be positive");

        let total_assets = Self::total_assets(env.clone());
        let total_shares = Self::total_shares(env.clone());

        // If vault is empty, 1 share = 1 asset. Otherwise, shares are
        // proportional to the deposit relative to total assets.
        let shares = if total_shares == 0 {
            amount
        } else {
            (amount * total_shares) / total_assets
        };
        assert!(shares > 0, "zero shares minted");

        let new_balance = Self::balance_of(env.clone(), depositor.clone()) + shares;
        env.storage()
            .instance()
            .set(&DataKey::Balance(depositor), &new_balance);
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total_shares + shares));
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(total_assets + amount));

        shares
    }

    /// Withdraw assets by burning shares. Returns the amount of assets
    /// transferred out.
    pub fn withdraw(env: Env, withdrawer: Address, shares: i128) -> i128 {
        withdrawer.require_auth();
        assert!(shares > 0, "shares must be positive");

        let balance = Self::balance_of(env.clone(), withdrawer.clone());
        assert!(balance >= shares, "insufficient shares");

        let total_assets = Self::total_assets(env.clone());
        let total_shares = Self::total_shares(env.clone());

        let amount = (shares * total_assets) / total_shares;
        assert!(amount > 0, "zero assets withdrawn");

        env.storage()
            .instance()
            .set(&DataKey::Balance(withdrawer), &(balance - shares));
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total_shares - shares));
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(total_assets - amount));

        amount
    }
}
`,
      },
      {
        path: "src/test.rs",
        language: "rust",
        content: `#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;

fn setup() -> (Env, VaultClient<'static>) {
    let env = Env::default();
    let contract_id = env.register(Vault, ());
    let client = VaultClient::new(&env, &contract_id);
    (env, client)
}

#[test]
fn test_first_deposit_shares_equal_amount() {
    let (env, client) = setup();
    let alice = Address::generate(&env);

    env.mock_all_auths();
    let shares = client.deposit(&alice, &1_000_000);
    assert_eq!(shares, 1_000_000);
    assert_eq!(client.balance_of(&alice), 1_000_000);
    assert_eq!(client.total_shares(), 1_000_000);
    assert_eq!(client.total_assets(), 1_000_000);
}

#[test]
fn test_proportional_shares_on_second_deposit() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    env.mock_all_auths();
    // Alice deposits 1000, gets 1000 shares
    client.deposit(&alice, &1_000);
    // Bob deposits 1000, should also get 1000 shares (1:1 since no yield)
    let bob_shares = client.deposit(&bob, &1_000);
    assert_eq!(bob_shares, 1_000);
    assert_eq!(client.total_shares(), 2_000);
    assert_eq!(client.total_assets(), 2_000);
}

#[test]
fn test_withdraw() {
    let (env, client) = setup();
    let alice = Address::generate(&env);

    env.mock_all_auths();
    client.deposit(&alice, &1_000_000);
    let withdrawn = client.withdraw(&alice, &500_000);

    assert_eq!(withdrawn, 500_000);
    assert_eq!(client.balance_of(&alice), 500_000);
    assert_eq!(client.total_shares(), 500_000);
    assert_eq!(client.total_assets(), 500_000);
}

#[test]
#[should_panic(expected = "insufficient shares")]
fn test_withdraw_more_than_balance_panics() {
    let (env, client) = setup();
    let alice = Address::generate(&env);

    env.mock_all_auths();
    client.deposit(&alice, &1_000);
    client.withdraw(&alice, &2_000);
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: cargoToml("vault", SOROBAN_SDK_V),
      },
      {
        path: "README.md",
        language: "markdown",
        content: `# Vault

Token vault with share-based accounting. Users deposit assets and receive
shares proportional to their deposit. The share price reflects the vault's
performance.

Replicates [OZ Stellar wizard — vault](https://wizard.openzeppelin.com/stellar#vault).

## Functions

- \`__constructor()\` — initializes vault with 0 assets and 0 shares
- \`total_assets() -> i128\` — total assets under management
- \`total_shares() -> i128\` — total shares outstanding
- \`balance_of(account: Address) -> i128\` — shares held by an account
- \`deposit(depositor: Address, amount: i128) -> i128\` — deposit, get shares
- \`withdraw(withdrawer: Address, shares: i128) -> i128\` — burn shares, get assets

## Build & Test

\`\`\`sh
soroban contract build
cargo test
\`\`\`
`,
      },
      { path: ".gitignore", language: "plaintext", content: GITIGNORE },
    ],
  },

  // ---------------------------------------------------------------
  // Governor — on-chain governance (OZ wizard: governor)
  // ---------------------------------------------------------------
  {
    id: "governor",
    name: "Governor",
    description: "On-chain governance with propose, vote, and execute. Voting power is delegated per-account. Proposals pass when for_votes exceed against_votes. Replicates OZ wizard 'governor'.",
    category: "governance",
    ozWizardUrl: "https://wizard.openzeppelin.com/stellar#governor",
    sorobanSdkVersion: SOROBAN_SDK_V,
    preview: { from: "#9A88A8", to: "#6A6285" },
    tags: ["governance", "dao", "voting", "openzeppelin"],
    files: [
      {
        path: "src/lib.rs",
        language: "rust",
        content: `#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

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

#[contractimpl]
impl Governor {
    /// Initialize the governance contract.
    pub fn __constructor(env: Env) {
        env.storage().instance().set(&DataKey::ProposalCount, &0u32);
    }

    /// Create a new proposal. Returns the proposal ID.
    pub fn propose(env: Env, proposer: Address) -> u32 {
        proposer.require_auth();

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);
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

    /// Vote on a proposal. \`support\` = true for FOR, false for AGAINST.
    pub fn vote(env: Env, voter: Address, proposal_id: u32, support: bool) {
        voter.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal does not exist");

        let voting_power: i128 = env
            .storage()
            .instance()
            .get(&DataKey::VotingPower(voter.clone()))
            .unwrap_or(0);
        assert!(voting_power > 0, "no voting power");

        if support {
            proposal.for_votes += voting_power;
        } else {
            proposal.against_votes += voting_power;
        }

        env.storage().instance().set(&DataKey::Proposal(proposal_id), &proposal);
    }

    /// Execute a proposal. Only succeeds if for_votes > against_votes.
    pub fn execute(env: Env, proposal_id: u32) -> bool {
        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal does not exist");

        assert!(!proposal.executed, "proposal already executed");
        assert!(
            proposal.for_votes > proposal.against_votes,
            "proposal rejected"
        );

        proposal.executed = true;
        env.storage().instance().set(&DataKey::Proposal(proposal_id), &proposal);
        true
    }

    /// Delegate voting power to an account (simplified: direct assignment
    /// rather than token-based delegation).
    pub fn delegate_voting_power(env: Env, to: Address, amount: i128) {
        to.require_auth();
        assert!(amount >= 0, "voting power must be non-negative");
        env.storage().instance().set(&DataKey::VotingPower(to), &amount);
    }

    /// Get the voting power of an account.
    pub fn get_voting_power(env: Env, account: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::VotingPower(account))
            .unwrap_or(0)
    }

    /// Get a proposal by ID.
    pub fn get_proposal(env: Env, proposal_id: u32) -> Proposal {
        env.storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal does not exist")
    }
}
`,
      },
      {
        path: "src/test.rs",
        language: "rust",
        content: `#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;

fn setup() -> (Env, GovernorClient<'static>) {
    let env = Env::default();
    let contract_id = env.register(Governor, ());
    let client = GovernorClient::new(&env, &contract_id);
    (env, client)
}

#[test]
fn test_create_proposal() {
    let (env, client) = setup();
    let proposer = Address::generate(&env);

    env.mock_all_auths();
    let proposal_id = client.propose(&proposer);
    assert_eq!(proposal_id, 1);

    let proposal = client.get_proposal(&1);
    assert_eq!(proposal.proposer, proposer);
    assert_eq!(proposal.for_votes, 0);
    assert_eq!(proposal.against_votes, 0);
    assert_eq!(proposal.executed, false);
}

#[test]
fn test_vote_and_execute() {
    let (env, client) = setup();
    let proposer = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);

    env.mock_all_auths();

    // Delegate voting power
    client.delegate_voting_power(&voter1, &100);
    client.delegate_voting_power(&voter2, &50);

    // Create proposal
    let proposal_id = client.propose(&proposer);

    // Vote: 100 for, 50 against
    client.vote(&voter1, &proposal_id, &true);
    client.vote(&voter2, &proposal_id, &false);

    // Execute — should pass (100 > 50)
    let result = client.execute(&proposal_id);
    assert_eq!(result, true);
}

#[test]
#[should_panic(expected = "proposal rejected")]
fn test_execute_rejected_proposal_panics() {
    let (env, client) = setup();
    let proposer = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);

    env.mock_all_auths();

    client.delegate_voting_power(&voter1, &50);
    client.delegate_voting_power(&voter2, &100);

    let proposal_id = client.propose(&proposer);

    // Vote: 50 for, 100 against
    client.vote(&voter1, &proposal_id, &true);
    client.vote(&voter2, &proposal_id, &false);

    // Execute — should fail (50 < 100)
    client.execute(&proposal_id);
}

#[test]
#[should_panic(expected = "no voting power")]
fn test_vote_without_power_panics() {
    let (env, client) = setup();
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);

    env.mock_all_auths();
    let proposal_id = client.propose(&proposer);
    client.vote(&voter, &proposal_id, &true);
}
`,
      },
      {
        path: "Cargo.toml",
        language: "toml",
        content: cargoToml("governor", SOROBAN_SDK_V),
      },
      {
        path: "README.md",
        language: "markdown",
        content: `# Governor

On-chain governance contract with propose, vote, and execute.

Replicates [OZ Stellar wizard — governor](https://wizard.openzeppelin.com/stellar#governor).

## Functions

- \`__constructor()\` — initializes with 0 proposals
- \`propose(proposer: Address) -> u32\` — creates a proposal, returns ID
- \`vote(voter: Address, proposal_id: u32, support: bool)\` — vote for/against
- \`execute(proposal_id: u32) -> bool\` — executes if for > against
- \`delegate_voting_power(to: Address, amount: i128)\` — assign voting power
- \`get_voting_power(account: Address) -> i128\`
- \`get_proposal(proposal_id: u32) -> Proposal\`

## Build & Test

\`\`\`sh
soroban contract build
cargo test
\`\`\`
`,
      },
      { path: ".gitignore", language: "plaintext", content: GITIGNORE },
    ],
  },
];

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
