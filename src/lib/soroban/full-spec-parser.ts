/**
 * Enhanced contract spec parser.
 *
 * Parses a Soroban contract's Rust source to extract:
 *   - Functions (name, args, return type, visibility, doc comments)
 *   - User-defined types (structs, enums, type aliases)
 *   - Documentation comments (/// doc comments)
 *
 * This is used by the Inspect + Docs panels to show contract metadata
 * after a successful build, without needing the .wasm spec file.
 */

export interface ContractFunction {
  name: string;
  args: { name: string; type: string; doc?: string }[];
  returnType: string;
  isConstructor: boolean;
  doc?: string;
  visibility: "pub" | "private";
}

export interface ContractStruct {
  name: string;
  fields: { name: string; type: string }[];
  doc?: string;
  isEvent?: boolean;
}

export interface ContractEnum {
  name: string;
  variants: { name: string; data?: string }[];
  doc?: string;
}

export interface ContractTypeAlias {
  name: string;
  alias: string;
  doc?: string;
}

export interface ContractSpec {
  functions: ContractFunction[];
  structs: ContractStruct[];
  enums: ContractEnum[];
  typeAliases: ContractTypeAlias[];
  contractName?: string;
  contractDoc?: string;
}

/**
 * Parse a Soroban contract's Rust source to extract the full contract spec.
 */
export function parseFullContractSpec(source: string): ContractSpec {
  const lines = source.split("\n");
  const spec: ContractSpec = {
    functions: [],
    structs: [],
    enums: [],
    typeAliases: [],
  };

  let i = 0;
  let pendingDoc: string[] = [];

  // Track if we're inside an impl block
  let inImpl = false;
  let contractName: string | null = null;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Collect doc comments (/// or //!)
    if (trimmed.startsWith("///")) {
      pendingDoc.push(trimmed.slice(3).trim());
      i++;
      continue;
    }

    // Inner doc comment (//! at the top of the file = contract-level docs)
    if (trimmed.startsWith("//!")) {
      if (!spec.contractDoc) spec.contractDoc = "";
      spec.contractDoc += trimmed.slice(3).trim() + "\n";
      i++;
      continue;
    }

    // Reset pending doc if this line is not a doc comment and not empty
    // (but keep it for the next declaration)
    if (trimmed === "" || trimmed.startsWith("//")) {
      if (!trimmed.startsWith("///")) pendingDoc = [];
      i++;
      continue;
    }

    const doc = pendingDoc.length > 0 ? pendingDoc.join("\n") : undefined;
    pendingDoc = [];

    // Detect #[contract] attribute → get the contract struct name
    const contractAttrMatch = trimmed.match(/^#\[contract\]/);
    if (contractAttrMatch) {
      // Next non-empty line should be "pub struct ContractName;"
      i++;
      while (i < lines.length && lines[i].trim() === "") i++;
      if (i < lines.length) {
        const structMatch = lines[i].trim().match(/^pub\s+struct\s+(\w+)/);
        if (structMatch) {
          contractName = structMatch[1];
          spec.contractName = contractName;
        }
      }
      i++;
      continue;
    }

    // Detect #[contractimpl] → start of impl block
    if (trimmed.match(/^#\[contractimpl\]/)) {
      inImpl = true;
      i++;
      // Next line should be "impl ContractName {"
      while (i < lines.length && lines[i].trim() === "") i++;
      if (i < lines.length) {
        const implMatch = lines[i].trim().match(/^impl\s+(\w+)/);
        if (implMatch && !contractName) {
          contractName = implMatch[1];
          spec.contractName = contractName;
        }
      }
      i++;
      continue;
    }

    // Detect end of impl block
    if (trimmed === "}") {
      inImpl = false;
      i++;
      continue;
    }

    // Inside impl block → parse functions
    if (inImpl) {
      const fnMatch = trimmed.match(
        /^(pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{?/
      );
      if (fnMatch) {
        const visibility = fnMatch[1] ? "pub" : "private";
        const name = fnMatch[2];
        const argsStr = fnMatch[3].trim();
        const returnType = (fnMatch[4] ?? "()").trim();

        // Parse args
        const args: { name: string; type: string; doc?: string }[] = [];
        if (argsStr) {
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

        spec.functions.push({
          name,
          args,
          returnType,
          isConstructor: name === "__constructor",
          doc,
          visibility: visibility as "pub" | "private",
        });
        i++;
        continue;
      }
    }

    // Outside impl block → parse types

    // #[contracttype] struct
    if (trimmed.match(/^#\[contracttype/) || trimmed.match(/^pub\s+struct\s+/)) {
      // Check if next non-attr line is a struct
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith("#[")) j++;
      if (j < lines.length) {
        const structMatch = lines[j].trim().match(/^pub\s+struct\s+(\w+)\s*\{/);
        if (structMatch) {
          const structName = structMatch[1];
          const isEvent = trimmed.includes("contractevent");
          const fields = parseStructFields(lines, j);
          spec.structs.push({
            name: structName,
            fields,
            doc,
            isEvent,
          });
          // Skip past the struct
          i = j + 1;
          while (i < lines.length && lines[i].trim() !== "}") i++;
          i++;
          continue;
        }
      }
    }

    // #[contracttype] enum
    if (trimmed.match(/^#\[contracttype/) || trimmed.match(/^pub\s+enum\s+/)) {
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith("#[")) j++;
      if (j < lines.length) {
        const enumMatch = lines[j].trim().match(/^pub\s+enum\s+(\w+)\s*\{/);
        if (enumMatch) {
          const enumName = enumMatch[1];
          const variants = parseEnumVariants(lines, j);
          spec.enums.push({
            name: enumName,
            variants,
            doc,
          });
          // Skip past the enum
          i = j + 1;
          while (i < lines.length && lines[i].trim() !== "}") i++;
          i++;
          continue;
        }
      }
    }

    // Type alias: pub type Name = Something;
    const typeAliasMatch = trimmed.match(/^pub\s+type\s+(\w+)\s*=\s*(.+);/);
    if (typeAliasMatch) {
      spec.typeAliases.push({
        name: typeAliasMatch[1],
        alias: typeAliasMatch[2].trim(),
        doc,
      });
      i++;
      continue;
    }

    // Const: pub const NAME: Type = value;
    // (We don't include consts in the spec for now, but could add later)

    i++;
  }

  return spec;
}

function parseArg(argStr: string): { name: string; type: string; doc?: string } {
  const colonIdx = argStr.indexOf(":");
  if (colonIdx < 0) return { name: argStr, type: "unknown" };
  const name = argStr.substring(0, colonIdx).trim();
  const type = argStr.substring(colonIdx + 1).trim();
  return { name, type };
}

function parseStructFields(lines: string[], startIdx: number): { name: string; type: string }[] {
  const fields: { name: string; type: string }[] = [];
  let i = startIdx + 1;
  let depth = 1;
  while (i < lines.length && depth > 0) {
    const trimmed = lines[i].trim();
    if (trimmed === "}") {
      depth--;
      break;
    }
    if (trimmed === "{" || trimmed.endsWith("{")) depth++;
    // Match field: pub name: Type,
    const fieldMatch = trimmed.match(/^pub\s+(\w+)\s*:\s*(.+?),?$/);
    if (fieldMatch) {
      fields.push({ name: fieldMatch[1], type: fieldMatch[2].replace(/,$/, "").trim() });
    }
    i++;
  }
  return fields;
}

function parseEnumVariants(lines: string[], startIdx: number): { name: string; data?: string }[] {
  const variants: { name: string; data?: string }[] = [];
  let i = startIdx + 1;
  let depth = 1;
  while (i < lines.length && depth > 0) {
    const trimmed = lines[i].trim();
    if (trimmed === "}") {
      depth--;
      break;
    }
    if (trimmed === "{" || trimmed.endsWith("{")) depth++;
    // Match variant: Name, Name(Type), Name { field: Type },
    const variantMatch = trimmed.match(/^(\w+)\s*(?:\(([^)]*)\))?\s*(?:\{[^}]*\})?\s*,?$/);
    if (variantMatch && variantMatch[1] !== "}" && !trimmed.startsWith("//")) {
      variants.push({
        name: variantMatch[1],
        data: variantMatch[2] || undefined,
      });
    }
    i++;
  }
  return variants;
}

/**
 * Format a type for display (simplify complex generics).
 */
export function formatType(type: string): string {
  return type
    .replace(/soroban_sdk::/g, "")
    .replace(/std::/g, "")
    .trim();
}

/**
 * Check if a type is a primitive (i32, u32, bool, etc.)
 */
export function isPrimitiveType(type: string): boolean {
  const primitives = [
    "i32", "u32", "i64", "u64", "i128", "u128",
    "bool", "()", "Bytes", "BytesN",
    "String", "Symbol", "Address", "Env",
  ];
  return primitives.some((p) => type === p || type.startsWith(`${p}<`));
}
