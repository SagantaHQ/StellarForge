/**
 * §3 — Contract spec parser.
 *
 * Parses a Soroban contract's Rust source to extract public function
 * signatures, generating an invoke UI specification.
 *
 * Each function gets:
 *   - name
 *   - args (name + type)
 *   - return type
 *
 * In production, this would use the contract's .wasm + soroban-spec to
 * extract the XDR spec. Here we parse the Rust source directly.
 */

export interface ContractFunction {
  name: string;
  args: { name: string; type: string }[];
  returnType: string;
  /** Whether this is a constructor (called once on deploy) */
  isConstructor: boolean;
  /**
   * Whether this function is read-only (doesn't modify contract state).
   * Heuristic: if the function body doesn't contain storage().set(),
   * storage().persistent().set(), or storage().instance().set(), we
   * treat it as read-only. Used to show "Query" vs "Transact" buttons.
   */
  isReadonly: boolean;
}

/**
 * Parse a Soroban contract's Rust source to extract public function signatures.
 *
 * Looks for patterns like:
 *   pub fn greet(env: Env, name: String) -> String { ... }
 *   pub fn __constructor(env: Env) { ... }
 *
 * Also extracts the function body (up to the matching closing brace) to
 * detect read-only functions (those that don't call storage().set()).
 */
export function parseContractSpec(source: string): ContractFunction[] {
  const functions: ContractFunction[] = [];

  // Match: pub fn <name>(<args>) -> <return_type> {
  // or:    pub fn <name>(<args>) {
  // Capture group 4 = everything after the opening brace (for body extraction)
  const fnRegex = /pub\s+fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{([\s\S]*?^\s*\})/gm;
  let match: RegExpExecArray | null;

  while ((match = fnRegex.exec(source)) !== null) {
    const name = match[1];
    const argsStr = match[2].trim();
    const returnType = match[3]?.trim() ?? "()";

    // Parse args — split by comma, each is "name: Type"
    const args: { name: string; type: string }[] = [];
    if (argsStr) {
      // Handle generic types with commas (e.g., Map<Address, i128>)
      let depth = 0;
      let current = "";
      for (const char of argsStr) {
        if (char === "<" || char === "(" || char === "[") depth++;
        if (char === ">" || char === ")" || char === "]") depth--;
        if (char === "," && depth === 0) {
          args.push(parseArg(current.trim()));
          current = "";
        } else {
          current += char;
        }
      }
      if (current.trim()) args.push(parseArg(current.trim()));
    }

    // Extract the function body to detect read-only-ness
    // match[4] is everything between { and the matching }
    const body = match[4] ?? "";

    // Read-only heuristic: if the body doesn't contain storage write
    // operations, it's likely a view/read function.
    // (Checks for .set(, .remove(, .extend( — all storage mutators)
    const isReadonly =
      !/\.storage\(\)\.(?:instance|persistent|temporary)\(\)\.(?:set|remove|extend)\s*\(/.test(body) &&
      !/\.set\s*\(\s*&/.test(body); // catch env.storage().instance().set(&...)

    functions.push({
      name,
      args,
      returnType: returnType.trim(),
      isConstructor: name === "__constructor",
      isReadonly: isReadonly && name !== "__constructor",
    });
  }

  return functions;
}

function parseArg(argStr: string): { name: string; type: string } {
  const colonIdx = argStr.indexOf(":");
  if (colonIdx < 0) return { name: argStr, type: "unknown" };
  const name = argStr.substring(0, colonIdx).trim();
  const type = argStr.substring(colonIdx + 1).trim();
  return { name, type };
}

/**
 * Generate a default value for a Soroban type (for the invoke UI).
 */
export function defaultValueForType(type: string): string {
  const t = type.trim();
  if (t === "i128" || t === "i64" || t === "i32" || t === "u128" || t === "u64" || t === "u32") return "0";
  if (t === "bool") return "false";
  if (t === "Address") return "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  if (t === "String") return "";
  if (t === "Bytes" || t.startsWith("BytesN<")) return "0x";
  if (t === "Env") return ""; // Env is implicit
  if (t.startsWith("Vec<")) return "[]";
  if (t.startsWith("Map<")) return "{}";
  if (t === "Symbol") return "symbol";
  return "";
}

/**
 * Format a value for display in the invoke result.
 */
export function formatInvokeResult(value: unknown): string {
  if (value === null || value === undefined) return "()";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
