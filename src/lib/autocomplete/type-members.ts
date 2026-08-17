/**
 * §Intelligent simple-mode autocomplete (2026-08-16)
 *
 * The rustdoc index is FLAT — it has 1855 symbols but no parent-child
 * relationships. So after `String::` the simple provider can't know which
 * symbols are members of String vs Vec vs anything else.
 *
 * This module provides a curated knowledge base of common Soroban SDK
 * types and their members (associated functions + methods). When the user
 * types `String::` or `env.`, we look up the type and return only its
 * actual members — no more "same 1855 results for anything::".
 *
 * This is NOT full type inference (that's what rust-analyzer does). It's
 * a pragmatic static map covering ~30 common types + a lightweight source
 * parser that extracts `let x: Type = ...` bindings so we can resolve
 * `my_var.` to the right type's methods.
 *
 * Used by the simple autocomplete provider. The LSP provider doesn't need
 * this (RA does real type inference), but it CAN use the source parser as
 * a fallback when RA is still indexing.
 */

export interface TypeMember {
  name: string;
  kind: "function" | "method" | "constant" | "type_alias";
  signature?: string;
  docs?: string;
  /** True if this is an associated function (e.g. `String::from_str`), false if a method (e.g. `s.len()`). */
  is_associated: boolean;
}

export interface TypeInfo {
  /** Crate this type belongs to (e.g. "soroban_sdk"). */
  crate: string;
  /** All associated functions + methods. */
  members: TypeMember[];
}

/* ------------------------------------------------------------------ */
/* Curated type → members knowledge base                              */
/* ------------------------------------------------------------------ */

const SOROBAN_SDK = "soroban_sdk";

/**
 * Static map of common Soroban SDK types to their members.
 *
 * Sources:
 *   - soroban-sdk 27.0.5 rustdoc (data/rustdoc-index/soroban-sdk-index.json)
 *   - https://docs.rs/soroban-sdk/latest/soroban_sdk/
 *
 * This is curated, not auto-generated, because the rustdoc index doesn't
 * include parent-child relationships. The goal is to cover the types that
 * show up in 95% of Soroban contracts — String, Bytes, BytesN, Vec, Map,
 * Env, Address, Symbol, etc.
 *
 * `is_associated: true` means it's called as `Type::name(...)` (e.g.
 * `String::from_str(...)`). `is_associated: false` means it's called as
 * `instance.name(...)` (e.g. `s.len()`).
 */
export const TYPE_MEMBERS: Record<string, TypeInfo> = {
  // ─── String ────────────────────────────────────────────────────────
  String: {
    crate: SOROBAN_SDK,
    members: [
      { name: "from_str", kind: "function", is_associated: true, signature: "pub fn from_str(env: &Env, s: &str) -> String", docs: "Creates a String from a &str." },
      { name: "from_bytes", kind: "function", is_associated: true, signature: "pub fn from_bytes(env: &Env, bytes: &[u8]) -> String", docs: "Creates a String from a byte slice." },
      { name: "try_from_bytes", kind: "function", is_associated: true, signature: "pub fn try_from_bytes(env: &Env, bytes: &[u8]) -> Result<String, ()>", docs: "Creates a String from bytes, returning Err if not valid UTF-8." },
      { name: "new", kind: "function", is_associated: true, signature: "pub fn new(env: &Env) -> String", docs: "Creates an empty String." },
      { name: "len", kind: "method", is_associated: false, signature: "pub fn len(&self) -> u32", docs: "Returns the length in bytes." },
      { name: "is_empty", kind: "method", is_associated: false, signature: "pub fn is_empty(&self) -> bool", docs: "Returns true if the String has length 0." },
      { name: "push", kind: "method", is_associated: false, signature: "pub fn push(&mut self, b: u8)", docs: "Appends a byte to the end." },
      { name: "push_str", kind: "method", is_associated: false, signature: "pub fn push_str(&mut self, s: &str)", docs: "Appends a &str." },
      { name: "pop", kind: "method", is_associated: false, signature: "pub fn pop(&mut self) -> Option<u8>", docs: "Removes and returns the last byte." },
      { name: "to_bytes", kind: "method", is_associated: false, signature: "pub fn to_bytes(&self) -> Bytes", docs: "Converts to Bytes." },
      { name: "as_bytes", kind: "method", is_associated: false, signature: "pub fn as_bytes(&self) -> &[u8]", docs: "Returns the underlying bytes." },
    ],
  },

  // ─── Bytes ─────────────────────────────────────────────────────────
  Bytes: {
    crate: SOROBAN_SDK,
    members: [
      { name: "new", kind: "function", is_associated: true, signature: "pub fn new(env: &Env) -> Bytes", docs: "Creates an empty Bytes." },
      { name: "from_array", kind: "function", is_associated: true, signature: "pub fn from_array<const N: usize>(env: &Env, arr: [u8; N]) -> Bytes", docs: "Creates Bytes from a fixed-size array." },
      { name: "from_slice", kind: "function", is_associated: true, signature: "pub fn from_slice(env: &Env, slice: &[u8]) -> Bytes", docs: "Creates Bytes from a byte slice." },
      { name: "len", kind: "method", is_associated: false, signature: "pub fn len(&self) -> u32", docs: "Returns the length." },
      { name: "is_empty", kind: "method", is_associated: false, signature: "pub fn is_empty(&self) -> bool", docs: "Returns true if empty." },
      { name: "push", kind: "method", is_associated: false, signature: "pub fn push(&mut self, b: u8)", docs: "Appends a byte." },
      { name: "pop", kind: "method", is_associated: false, signature: "pub fn pop(&mut self) -> Option<u8>", docs: "Removes and returns the last byte." },
      { name: "get", kind: "method", is_associated: false, signature: "pub fn get(&self, i: u32) -> Option<u8>", docs: "Returns the byte at index i." },
      { name: "set", kind: "method", is_associated: false, signature: "pub fn set(&mut self, i: u32, b: u8)", docs: "Sets the byte at index i." },
      { name: "append", kind: "method", is_associated: false, signature: "pub fn append(&mut self, other: &Bytes)", docs: "Appends another Bytes." },
      { name: "to_array", kind: "method", is_associated: false, signature: "pub fn to_array<const N: usize>(&self) -> Result<[u8; N], ()>", docs: "Converts to a fixed-size array." },
    ],
  },

  // ─── BytesN ────────────────────────────────────────────────────────
  BytesN: {
    crate: SOROBAN_SDK,
    members: [
      { name: "from_array", kind: "function", is_associated: true, signature: "pub fn from_array<const N: usize>(env: &Env, arr: [u8; N]) -> BytesN<N>", docs: "Creates BytesN from a fixed-size array." },
      { name: "try_from_bytes", kind: "function", is_associated: true, signature: "pub fn try_from_bytes<const N: usize>(env: &Env, bytes: &Bytes) -> Result<BytesN<N>, ()>", docs: "Creates BytesN from a Bytes, if length matches." },
      { name: "len", kind: "method", is_associated: false, signature: "pub fn len(&self) -> u32", docs: "Returns the length (always N)." },
      { name: "get", kind: "method", is_associated: false, signature: "pub fn get(&self, i: u32) -> Option<u8>", docs: "Returns the byte at index i." },
      { name: "to_array", kind: "method", is_associated: false, signature: "pub fn to_array<const N: usize>(&self) -> [u8; N]", docs: "Converts to a fixed-size array." },
    ],
  },

  // ─── Vec ───────────────────────────────────────────────────────────
  Vec: {
    crate: SOROBAN_SDK,
    members: [
      { name: "new", kind: "function", is_associated: true, signature: "pub fn new(env: &Env) -> Vec<T>", docs: "Creates an empty Vec." },
      { name: "from_array", kind: "function", is_associated: true, signature: "pub fn from_array<const N: usize>(env: &Env, arr: [T; N]) -> Vec<T>", docs: "Creates a Vec from an array." },
      { name: "from_slice", kind: "function", is_associated: true, signature: "pub fn from_slice(env: &Env, slice: &[T]) -> Vec<T>", docs: "Creates a Vec from a slice." },
      { name: "len", kind: "method", is_associated: false, signature: "pub fn len(&self) -> u32", docs: "Returns the number of elements." },
      { name: "is_empty", kind: "method", is_associated: false, signature: "pub fn is_empty(&self) -> bool", docs: "Returns true if empty." },
      { name: "push", kind: "method", is_associated: false, signature: "pub fn push(&mut self, x: T)", docs: "Appends an element." },
      { name: "pop", kind: "method", is_associated: false, signature: "pub fn pop(&mut self) -> Option<T>", docs: "Removes and returns the last element." },
      { name: "get", kind: "method", is_associated: false, signature: "pub fn get(&self, i: u32) -> Option<T>", docs: "Returns the element at index i." },
      { name: "set", kind: "method", is_associated: false, signature: "pub fn set(&mut self, i: u32, x: T)", docs: "Sets the element at index i." },
      { name: "remove", kind: "method", is_associated: false, signature: "pub fn remove(&mut self, i: u32)", docs: "Removes the element at index i." },
      { name: "insert", kind: "method", is_associated: false, signature: "pub fn insert(&mut self, i: u32, x: T)", docs: "Inserts an element at index i." },
      { name: "iter", kind: "method", is_associated: false, signature: "pub fn iter(&self) -> VecIter<T>", docs: "Returns an iterator." },
      { name: "first", kind: "method", is_associated: false, signature: "pub fn first(&self) -> Option<T>", docs: "Returns the first element." },
      { name: "last", kind: "method", is_associated: false, signature: "pub fn last(&self) -> Option<T>", docs: "Returns the last element." },
    ],
  },

  // ─── Map ───────────────────────────────────────────────────────────
  Map: {
    crate: SOROBAN_SDK,
    members: [
      { name: "new", kind: "function", is_associated: true, signature: "pub fn new(env: &Env) -> Map<K, V>", docs: "Creates an empty Map." },
      { name: "from_arrays", kind: "function", is_associated: true, signature: "pub fn from_arrays<const N: usize>(env: &Env, keys: [K; N], vals: [V; N]) -> Map<K, V>", docs: "Creates a Map from key + value arrays." },
      { name: "len", kind: "method", is_associated: false, signature: "pub fn len(&self) -> u32", docs: "Returns the number of entries." },
      { name: "is_empty", kind: "method", is_associated: false, signature: "pub fn is_empty(&self) -> bool", docs: "Returns true if empty." },
      { name: "get", kind: "method", is_associated: false, signature: "pub fn get(&self, k: K) -> Option<V>", docs: "Returns the value for key k." },
      { name: "set", kind: "method", is_associated: false, signature: "pub fn set(&mut self, k: K, v: V)", docs: "Sets key k to value v." },
      { name: "remove", kind: "method", is_associated: false, signature: "pub fn remove(&mut self, k: K) -> Option<V>", docs: "Removes the entry for key k." },
      { name: "contains_key", kind: "method", is_associated: false, signature: "pub fn contains_key(&self, k: K) -> bool", docs: "Returns true if key k exists." },
      { name: "keys", kind: "method", is_associated: false, signature: "pub fn keys(&self) -> Vec<K>", docs: "Returns all keys." },
      { name: "values", kind: "method", is_associated: false, signature: "pub fn values(&self) -> Vec<V>", docs: "Returns all values." },
      { name: "iter", kind: "method", is_associated: false, signature: "pub fn iter(&self) -> MapIter<K, V>", docs: "Returns an iterator." },
    ],
  },

  // ─── Env ───────────────────────────────────────────────────────────
  Env: {
    crate: SOROBAN_SDK,
    members: [
      { name: "storage", kind: "method", is_associated: false, signature: "pub fn storage(&self) -> Storage", docs: "Access to persistent + temporary storage." },
      { name: "events", kind: "method", is_associated: false, signature: "pub fn events(&self) -> Events", docs: "Publish contract events." },
      { name: "ledger", kind: "method", is_associated: false, signature: "pub fn ledger(&self) -> Ledger", docs: "Access ledger info (timestamp, sequence)." },
      { name: "current_contract_address", kind: "method", is_associated: false, signature: "pub fn current_contract_address(&self) -> Address", docs: "Returns this contract's address." },
      { name: "current_call_stack", kind: "method", is_associated: false, signature: "pub fn current_call_stack(&self) -> Vec<(Address, Option<Address>)>", docs: "Returns the current call stack." },
      { name: "invoke_contract", kind: "method", is_associated: false, signature: "pub fn invoke_contract<T>(&self, contract: Address, func: Symbol, args: Vec<Val>) -> T", docs: "Calls a function on another contract." },
      { name: "register_contract", kind: "method", is_associated: false, signature: "pub fn register_contract<T>(&self, id: BytesN<32>, contract: T)", docs: "Deploys a new contract instance." },
      { name: "register_contract_wasm", kind: "method", is_associated: false, signature: "pub fn register_contract_wasm(&self, id: BytesN<32>, wasm_hash: BytesN<32>)", docs: "Deploys a contract from Wasm hash." },
      { name: "crypto", kind: "method", is_associated: false, signature: "pub fn crypto(&self) -> Crypto", docs: "Access to cryptographic functions." },
      { name: "prng", kind: "method", is_associated: false, signature: "pub fn prng(&self) -> Prng", docs: "Access to pseudo-random number generation." },
      { name: "budget", kind: "method", is_associated: false, signature: "pub fn budget(&self) -> Budget", docs: "Access to the resource budget." },
      { name: "today", kind: "method", is_associated: false, signature: "pub fn today(&self) -> u32", docs: "Returns the current ledger sequence number." },
    ],
  },

  // ─── Address ───────────────────────────────────────────────────────
  Address: {
    crate: SOROBAN_SDK,
    members: [
      { name: "from_str", kind: "function", is_associated: true, signature: "pub fn from_str(env: &Env, s: &str) -> Address", docs: "Parses an Address from a strkey string." },
      { name: "try_from_bytes", kind: "function", is_associated: true, signature: "pub fn try_from_bytes(env: &Env, bytes: &Bytes) -> Result<Address, ()>", docs: "Creates an Address from raw bytes." },
      { name: "to_string", kind: "method", is_associated: false, signature: "pub fn to_string(&self) -> String", docs: "Returns the strkey representation." },
      { name: "require_auth", kind: "method", is_associated: false, signature: "pub fn require_auth(&self)", docs: "Requires this address to have signed the transaction." },
      { name: "require_auth_for_args", kind: "method", is_associated: false, signature: "pub fn require_auth_for_args(&self, args: Vec<Val>)", docs: "Requires auth for specific args." },
      { name: "as_bytes", kind: "method", is_associated: false, signature: "pub fn as_bytes(&self) -> BytesN<32>", docs: "Returns the raw 32-byte representation." },
    ],
  },

  // ─── Symbol ────────────────────────────────────────────────────────
  Symbol: {
    crate: SOROBAN_SDK,
    members: [
      { name: "new", kind: "function", is_associated: true, signature: "pub fn new(env: &Env, s: &str) -> Symbol", docs: "Creates a Symbol from a &str (max 9 chars)." },
      { name: "from_bytes", kind: "function", is_associated: true, signature: "pub fn from_bytes(env: &Env, bytes: &[u8]) -> Symbol", docs: "Creates a Symbol from bytes." },
      { name: "try_from_bytes", kind: "function", is_associated: true, signature: "pub fn try_from_bytes(env: &Env, bytes: &[u8]) -> Result<Symbol, ()>", docs: "Creates a Symbol from bytes, returning Err if invalid." },
      { name: "to_string", kind: "method", is_associated: false, signature: "pub fn to_string(&self) -> String", docs: "Returns the Symbol as a String." },
      { name: "as_bytes", kind: "method", is_associated: false, signature: "pub fn as_bytes(&self) -> &[u8]", docs: "Returns the underlying bytes." },
    ],
  },

  // ─── SorobanAuth ───────────────────────────────────────────────────
  SorobanAuth: {
    crate: SOROBAN_SDK,
    members: [
      { name: "AuthorizationManager", kind: "type_alias", is_associated: true, docs: "Manages contract authorization." },
    ],
  },

  // ─── Val ───────────────────────────────────────────────────────────
  Val: {
    crate: SOROBAN_SDK,
    members: [
      { name: "from_i32", kind: "function", is_associated: true, signature: "pub fn from_i32(v: i32) -> Val", docs: "Creates a Val from an i32." },
      { name: "from_u32", kind: "function", is_associated: true, signature: "pub fn from_u32(v: u32) -> Val", docs: "Creates a Val from a u32." },
      { name: "to_i32", kind: "method", is_associated: false, signature: "pub fn to_i32(&self) -> Result<i32, ()>", docs: "Converts to an i32." },
    ],
  },

  // ─── Storage ───────────────────────────────────────────────────────
  Storage: {
    crate: SOROBAN_SDK,
    members: [
      { name: "get", kind: "method", is_associated: false, signature: "pub fn get<K, V>(&self, key: &K) -> Option<V>", docs: "Gets a value from persistent storage." },
      { name: "set", kind: "method", is_associated: false, signature: "pub fn set<K, V>(&self, key: &K, val: &V)", docs: "Sets a value in persistent storage." },
      { name: "remove", kind: "method", is_associated: false, signature: "pub fn remove<K>(&self, key: &K)", docs: "Removes a key from persistent storage." },
      { name: "has", kind: "method", is_associated: false, signature: "pub fn has<K>(&self, key: &K) -> bool", docs: "Returns true if the key exists." },
      { name: "get_temporary", kind: "method", is_associated: false, signature: "pub fn get_temporary<K, V>(&self, key: &K) -> Option<V>", docs: "Gets a value from temporary storage." },
      { name: "set_temporary", kind: "method", is_associated: false, signature: "pub fn set_temporary<K, V>(&self, key: &K, val: &V)", docs: "Sets a value in temporary storage." },
      { name: "remove_temporary", kind: "method", is_associated: false, signature: "pub fn remove_temporary<K>(&self, key: &K)", docs: "Removes a key from temporary storage." },
    ],
  },

  // ─── Ledger ────────────────────────────────────────────────────────
  Ledger: {
    crate: SOROBAN_SDK,
    members: [
      { name: "timestamp", kind: "method", is_associated: false, signature: "pub fn timestamp(&self) -> u64", docs: "Returns the ledger close time in seconds since Unix epoch." },
      { name: "sequence", kind: "method", is_associated: false, signature: "pub fn sequence(&self) -> u32", docs: "Returns the ledger sequence number." },
      { name: "protocol_version", kind: "method", is_associated: false, signature: "pub fn protocol_version(&self) -> u32", docs: "Returns the protocol version." },
      { name: "max_live_until_ledger", kind: "method", is_associated: false, signature: "pub fn max_live_until_ledger(&self) -> u32", docs: "Returns the maximum ledger an entry can live until." },
    ],
  },

  // ─── Crypto ────────────────────────────────────────────────────────
  Crypto: {
    crate: SOROBAN_SDK,
    members: [
      { name: "sha256", kind: "method", is_associated: false, signature: "pub fn sha256(&self, input: &Bytes) -> BytesN<32>", docs: "Computes SHA-256." },
      { name: "keccak256", kind: "method", is_associated: false, signature: "pub fn keccak256(&self, input: &Bytes) -> BytesN<32>", docs: "Computes Keccak-256." },
      { name: "ed25519_verify", kind: "method", is_associated: false, signature: "pub fn ed25519_verify(&self, public_key: &BytesN<32>, signature: &BytesN<64>, message: &Bytes) -> bool", docs: "Verifies an Ed25519 signature." },
      { name: "ed25519_recover", kind: "method", is_associated: false, signature: "pub fn ed25519_recover(&self, signature: &BytesN<64>, message: &Bytes) -> Result<BytesN<32>, ()>", docs: "Recovers the public key from a signature." },
    ],
  },

  // ─── Events ────────────────────────────────────────────────────────
  Events: {
    crate: SOROBAN_SDK,
    members: [
      { name: "publish", kind: "method", is_associated: false, signature: "pub fn publish(&self, topics: Vec<Val>, data: Val)", docs: "Publishes a contract event." },
    ],
  },

  // ─── Budget ────────────────────────────────────────────────────────
  Budget: {
    crate: SOROBAN_SDK,
    members: [
      { name: "cpu_instruction_limit", kind: "method", is_associated: false, signature: "pub fn cpu_instruction_limit(&self) -> u64", docs: "Returns the CPU instruction limit." },
      { name: "memory_byte_limit", kind: "method", is_associated: false, signature: "pub fn memory_byte_limit(&self) -> u64", docs: "Returns the memory byte limit." },
      { name: "cpu_instruction_consumed", kind: "method", is_associated: false, signature: "pub fn cpu_instruction_consumed(&self) -> u64", docs: "Returns CPU instructions consumed so far." },
      { name: "memory_byte_consumed", kind: "method", is_associated: false, signature: "pub fn memory_byte_consumed(&self) -> u64", docs: "Returns memory bytes consumed so far." },
    ],
  },

  // ─── Prng ──────────────────────────────────────────────────────────
  Prng: {
    crate: SOROBAN_SDK,
    members: [
      { name: "u8_in_inclusive_range", kind: "method", is_associated: false, signature: "pub fn u8_in_inclusive_range(&self, lo: u8, hi: u8) -> u8", docs: "Returns a random u8 in [lo, hi]." },
      { name: "u32_in_inclusive_range", kind: "method", is_associated: false, signature: "pub fn u32_in_inclusive_range(&self, lo: u32, hi: u32) -> u32", docs: "Returns a random u32 in [lo, hi]." },
      { name: "u64_in_inclusive_range", kind: "method", is_associated: false, signature: "pub fn u64_in_inclusive_range(&self, lo: u64, hi: u64) -> u64", docs: "Returns a random u64 in [lo, hi]." },
      { name: "u128_in_inclusive_range", kind: "method", is_associated: false, signature: "pub fn u128_in_inclusive_range(&self, lo: u128, hi: u128) -> u128", docs: "Returns a random u128 in [lo, hi]." },
      { name: "shuffle_slice", kind: "method", is_associated: false, signature: "pub fn shuffle_slice<T>(&self, slice: &mut [T])", docs: "Shuffles a slice in place." },
    ],
  },

  // ─── I128 ──────────────────────────────────────────────────────────
  I128: {
    crate: SOROBAN_SDK,
    members: [
      { name: "from_i64", kind: "function", is_associated: true, signature: "pub fn from_i64(env: &Env, v: i64) -> I128", docs: "Creates an I128 from an i64." },
      { name: "from_parts", kind: "function", is_associated: true, signature: "pub fn from_parts(env: &Env, hi: i64, lo: u64) -> I128", docs: "Creates an I128 from high + low parts." },
      { name: "to_i64", kind: "method", is_associated: false, signature: "pub fn to_i64(&self) -> Result<i64, ()>", docs: "Converts to an i64, if it fits." },
      { name: "add", kind: "method", is_associated: false, signature: "pub fn add(&self, other: &I128) -> I128", docs: "Adds two I128 values." },
      { name: "sub", kind: "method", is_associated: false, signature: "pub fn sub(&self, other: &I128) -> I128", docs: "Subtracts two I128 values." },
      { name: "mul", kind: "method", is_associated: false, signature: "pub fn mul(&self, other: &I128) -> I128", docs: "Multiplies two I128 values." },
    ],
  },

  // ─── U128 ──────────────────────────────────────────────────────────
  U128: {
    crate: SOROBAN_SDK,
    members: [
      { name: "from_u64", kind: "function", is_associated: true, signature: "pub fn from_u64(env: &Env, v: u64) -> U128", docs: "Creates a U128 from a u64." },
      { name: "from_parts", kind: "function", is_associated: true, signature: "pub fn from_parts(env: &Env, hi: u64, lo: u64) -> U128", docs: "Creates a U128 from high + low parts." },
      { name: "to_u64", kind: "method", is_associated: false, signature: "pub fn to_u64(&self) -> Result<u64, ()>", docs: "Converts to a u64, if it fits." },
      { name: "add", kind: "method", is_associated: false, signature: "pub fn add(&self, other: &U128) -> U128", docs: "Adds two U128 values." },
      { name: "sub", kind: "method", is_associated: false, signature: "pub fn sub(&self, other: &U128) -> U128", docs: "Subtracts two U128 values." },
      { name: "mul", kind: "method", is_associated: false, signature: "pub fn mul(&self, other: &U128) -> U128", docs: "Multiplies two U128 values." },
    ],
  },

  // ─── I256 / U256 (if present) ──────────────────────────────────────
  I256: {
    crate: SOROBAN_SDK,
    members: [
      { name: "from_i128", kind: "function", is_associated: true, signature: "pub fn from_i128(env: &Env, v: I128) -> I256", docs: "Creates an I256 from an I128." },
      { name: "to_i128", kind: "method", is_associated: false, signature: "pub fn to_i128(&self) -> Result<I128, ()>", docs: "Converts to an I128, if it fits." },
    ],
  },

  U256: {
    crate: SOROBAN_SDK,
    members: [
      { name: "from_u128", kind: "function", is_associated: true, signature: "pub fn from_u128(env: &Env, v: U128) -> U256", docs: "Creates a U256 from a U128." },
      { name: "to_u128", kind: "method", is_associated: false, signature: "pub fn to_u128(&self) -> Result<U128, ()>", docs: "Converts to a U128, if it fits." },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Source-parsed variable → type inference                            */
/* ------------------------------------------------------------------ */

/**
 * Parses the source to build a map of `variable_name → TypeName`.
 *
 * Handles:
 *   - `let env: Env = Env::default();`           → env → Env
 *   - `let mut bytes = Bytes::new(&env);`        → bytes → Bytes (inferred from RHS)
 *   - `let counter: u32 = 0;`                    → counter → u32
 *   - `pub fn foo(env: Env, counter: u32) {...}` → env → Env, counter → u32
 *   - `for item in vec.iter()`                   → (skipped — needs full type inference)
 *
 * This is intentionally lightweight — regex-based, not a full AST. It
 * covers the common patterns and degrades gracefully (no parse error
 * possible — just returns an empty map).
 */
export function parseVariableTypes(source: string): Map<string, string> {
  const types = new Map<string, string>();

  // Pattern 1: `let <name>: <Type> = ...` — explicit type annotation
  //   Handles `let`, `let mut`, `let <name>`, etc.
  //   Type is the identifier after the colon (may have generics, but we
  //   only take the base type name).
  const explicitRe = /\blet\s+(?:mut\s+)?([a-z_][a-z0-9_]*)\s*:\s*([A-Z][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = explicitRe.exec(source)) !== null) {
    types.set(m[1], m[2]);
  }

  // Pattern 2: `let <name> = <Type>::...(...)` — inferred from RHS
  //   e.g. `let bytes = Bytes::new(&env);` → bytes → Bytes
  const inferredRe = /\blet\s+(?:mut\s+)?([a-z_][a-z0-9_]*)\s*=\s*([A-Z][A-Za-z0-9_]*)::/g;
  while ((m = inferredRe.exec(source)) !== null) {
    if (!types.has(m[1])) {
      types.set(m[1], m[2]);
    }
  }

  // Pattern 3: function params — `pub fn foo(env: Env, counter: u32)`
  //   Only top-level function signatures (not closures, which use `|x: T|`)
  const fnParamRe = /\b(?:pub\s+)?fn\s+[a-z_][a-z0-9_]*\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
  while ((m = fnParamRe.exec(source)) !== null) {
    const params = m[1].split(",");
    for (const param of params) {
      const pm = param.trim().match(/^([a-z_][a-z0-9_]*)\s*:\s*(?:&\s*(?:mut\s+)?)?([A-Z][A-Za-z0-9_]*)/);
      if (pm) {
        types.set(pm[1], pm[2]);
      }
    }
  }

  // Pattern 4: struct fields — `struct Foo { env: Env, ... }`
  //   These give us `self.env` access patterns.
  // (Not handled here — would require tracking struct definitions + field
  //  access via `self.field`. Skipping for now; LSP handles this correctly.)

  return types;
}

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Given a source string + a variable name, return the variable's type
 * (or null if unknown).
 *
 * Uses parseVariableTypes internally. Results are cached per-source-string
 * to avoid re-parsing on every keystroke (the source is the full file
 * content, which doesn't change between rapid keystrokes of the same
 * completion session).
 */
const parseCache = new Map<string, Map<string, string>>();
const MAX_CACHE_ENTRIES = 20;

export function lookupVariableType(source: string, varName: string): string | null {
  // Cache hit?
  let types = parseCache.get(source);
  if (!types) {
    types = parseVariableTypes(source);
    if (parseCache.size >= MAX_CACHE_ENTRIES) {
      // Evict oldest entry (Map preserves insertion order)
      const firstKey = parseCache.keys().next().value;
      if (firstKey !== undefined) parseCache.delete(firstKey);
    }
    parseCache.set(source, types);
  }
  return types.get(varName) ?? null;
}

/**
 * Returns the members of a type, or null if the type isn't in our knowledge
 * base. `typeName` should be the base type name (e.g. "String", "Vec", "Env")
 * without generic parameters.
 */
export function getTypeMembers(typeName: string): TypeMember[] | null {
  // Strip generic params if present (e.g. "Vec<T>" → "Vec")
  const baseName = typeName.replace(/<.*>/, "").trim();
  const info = TYPE_MEMBERS[baseName];
  return info ? info.members : null;
}

/**
 * Returns the crate a type belongs to, or null if unknown.
 */
export function getTypeCrate(typeName: string): string | null {
  const baseName = typeName.replace(/<.*>/, "").trim();
  const info = TYPE_MEMBERS[baseName];
  return info ? info.crate : null;
}

/**
 * Clear the parse cache. Called when the file changes (so stale variable
 * → type mappings don't persist across files).
 */
export function clearTypeCache(): void {
  parseCache.clear();
}
