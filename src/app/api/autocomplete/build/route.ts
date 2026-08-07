import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { spawn } from "child_process";
import { readFile, writeFile, mkdir, stat } from "fs/promises";
import path from "path";

/**
 * POST /api/autocomplete/build
 *
 * Builds autocomplete artifacts for a project by:
 *   1. Parsing the user's Rust source (src/lib.rs) for public items
 *   2. Parsing Cargo.toml dependencies for import suggestions
 *   3. Running `cargo doc --output-format json` for dependency API items
 *   4. Caching dependency artifacts by package+version in the DB
 *
 * Body: { projectId, files: [{path, content}] }
 * Returns: { artifacts: { functions, structs, enums, traits, constants, typeAliases, imports } }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BUILDS_DIR = "/tmp/soroban-builds";

interface CompletionItem {
  label: string;
  kind: string;
  detail?: string;
  documentation?: string;
  insertText?: string;
  insertTextRules?: string;
  module?: string;
  packageName?: string;
}

interface AutocompleteArtifacts {
  functions: CompletionItem[];
  structs: CompletionItem[];
  enums: CompletionItem[];
  traits: CompletionItem[];
  constants: CompletionItem[];
  typeAliases: CompletionItem[];
  imports: { path: string; name: string }[];
}

function emptyArtifacts(): AutocompleteArtifacts {
  return { functions: [], structs: [], enums: [], traits: [], constants: [], typeAliases: [], imports: [] };
}

function mergeArtifacts(target: AutocompleteArtifacts, source: AutocompleteArtifacts, pkg: string) {
  for (const key of ["functions", "structs", "enums", "traits", "constants", "typeAliases"] as const) {
    target[key].push(...source[key].map((item: CompletionItem) => ({ ...item, packageName: pkg })));
  }
  target.imports.push(...source.imports);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, files } = body;

    if (!projectId || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "Missing projectId or files" }, { status: 400 });
    }

    const home = process.env.HOME ?? "/home/z";
    const cargoBin = `${home}/.cargo/bin`;
    const env = { ...process.env, PATH: `${cargoBin}:${process.env.PATH ?? ""}`, CARGO_HOME: `${home}/.cargo`, RUSTUP_HOME: `${home}/.rustup` };

    // Set up workspace
    const workspaceDir = path.join(BUILDS_DIR, projectId);
    await mkdir(workspaceDir, { recursive: true });
    for (const file of files) {
      const filePath = path.join(workspaceDir, file.path);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, "utf-8");
    }

    // Parse the user's source for autocomplete items
    const libRs = files.find((f: { path: string; content: string }) => f.path === "src/lib.rs" || f.path.endsWith("lib.rs"));
    const userArtifacts = libRs ? parseRustSource(libRs.content) : emptyArtifacts();

    // Parse Cargo.toml for imports + dependencies
    const cargoToml = files.find((f: { path: string; content: string }) => f.path === "Cargo.toml");
    const { imports, dependencies } = cargoToml ? parseCargoToml(cargoToml.content) : { imports: [], dependencies: [] };

    // Try to get dependency artifacts from cache or cargo doc
    const depArtifacts = emptyArtifacts();

    // First, check DB cache for all deps
    for (const dep of dependencies) {
      const cacheKey = `${dep.name}@${dep.version}`;
      try {
        const cached = await db.autocompleteArtifact.findUnique({ where: { packageVersion: cacheKey } });
        if (cached) {
          mergeArtifacts(depArtifacts, JSON.parse(cached.artifactsJson), dep.name);
          continue;
        }
      } catch { /* DB unavailable */ }

      // Try cargo doc for this dep — but only if we haven't already built
      // We'll try to read from target/doc if it exists
      const crateName = dep.name.replace(/-/g, "_");
      const docJsonPath = path.join(workspaceDir, "target", "doc", `${crateName}.json`);
      try {
        await stat(docJsonPath);
        const raw = await readFile(docJsonPath, "utf-8");
        const parsed = parseRustDocJson(raw, dep.name);
        if (parsed) {
          mergeArtifacts(depArtifacts, parsed, dep.name);
          // Cache in DB
          try {
            await db.autocompleteArtifact.upsert({
              where: { packageVersion: cacheKey },
              update: { artifactsJson: JSON.stringify(parsed) },
              create: { packageVersion: cacheKey, packageName: dep.name, packageVersionStr: dep.version, artifactsJson: JSON.stringify(parsed) },
            });
          } catch { /* best-effort cache */ }
        }
      } catch {
        // No doc JSON available — skip this dep
      }
    }

    // Merge all
    const allArtifacts: AutocompleteArtifacts = {
      functions: [...userArtifacts.functions, ...depArtifacts.functions],
      structs: [...userArtifacts.structs, ...depArtifacts.structs],
      enums: [...userArtifacts.enums, ...depArtifacts.enums],
      traits: [...userArtifacts.traits, ...depArtifacts.traits],
      constants: [...userArtifacts.constants, ...depArtifacts.constants],
      typeAliases: [...userArtifacts.typeAliases, ...depArtifacts.typeAliases],
      imports: [...imports, ...depArtifacts.imports],
    };

    return NextResponse.json({ artifacts: allArtifacts, dependencies, cached: dependencies.length - depArtifacts.functions.filter((f: CompletionItem) => f.packageName).length });
  } catch (err) {
    return NextResponse.json({ error: "Failed to build autocomplete", detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

function parseRustSource(source: string): AutocompleteArtifacts {
  const artifacts = emptyArtifacts();
  const lines = source.split("\n");
  let currentDoc: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("///")) {
      currentDoc.push(line.slice(3).trim());
      continue;
    }

    const doc = currentDoc.length > 0 ? currentDoc.join("\n") : undefined;
    if (line && !line.startsWith("//") && !line.startsWith("#[")) {
      currentDoc = [];
    }

    const fnMatch = line.match(/^pub\s+(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{?/);
    if (fnMatch) {
      artifacts.functions.push({ label: fnMatch[1], kind: "function", detail: `fn ${fnMatch[1]}(${fnMatch[2].trim()}) -> ${(fnMatch[3] ?? "()").trim()}`, documentation: doc, insertText: `${fnMatch[1]}(${fnMatch[2].trim() ? "(${1:args})" : ""})`, insertTextRules: "InsertAsSnippet" });
      continue;
    }

    const structMatch = line.match(/^pub\s+struct\s+(\w+)/);
    if (structMatch) { artifacts.structs.push({ label: structMatch[1], kind: "struct", detail: `struct ${structMatch[1]}`, documentation: doc }); continue; }

    const enumMatch = line.match(/^pub\s+enum\s+(\w+)/);
    if (enumMatch) { artifacts.enums.push({ label: enumMatch[1], kind: "enum", detail: `enum ${enumMatch[1]}`, documentation: doc }); continue; }

    const traitMatch = line.match(/^pub\s+trait\s+(\w+)/);
    if (traitMatch) { artifacts.traits.push({ label: traitMatch[1], kind: "trait", detail: `trait ${traitMatch[1]}`, documentation: doc }); continue; }

    const constMatch = line.match(/^pub\s+const\s+(\w+)\s*:\s*(.+?)(?:\s*=|$)/);
    if (constMatch) { artifacts.constants.push({ label: constMatch[1], kind: "constant", detail: `const ${constMatch[1]}: ${constMatch[2].trim()}`, documentation: doc }); continue; }

    const typeMatch = line.match(/^pub\s+type\s+(\w+)\s*=\s*(.+?);/);
    if (typeMatch) { artifacts.typeAliases.push({ label: typeMatch[1], kind: "typeAlias", detail: `type ${typeMatch[1]} = ${typeMatch[2].trim()}`, documentation: doc }); continue; }
  }

  return artifacts;
}

function parseCargoToml(cargoToml: string): { imports: { path: string; name: string }[]; dependencies: { name: string; version: string }[] } {
  const imports: { path: string; name: string }[] = [];
  const dependencies: { name: string; version: string }[] = [];
  const lines = cargoToml.split("\n");
  let inDeps = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "[dependencies]") { inDeps = true; continue; }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) { inDeps = false; continue; }
    if (!inDeps) continue;

    const match = trimmed.match(/^([a-z0-9_-]+)\s*=\s*(?:"([^"]+)"|version\s*=\s*"([^"]+)")/);
    if (match) {
      const name = match[1];
      const version = match[2] ?? match[3] ?? "*";
      imports.push({ path: name.replace(/-/g, "_"), name });
      dependencies.push({ name, version });
    }
  }

  return { imports, dependencies };
}

function parseRustDocJson(raw: string, packageName: string): AutocompleteArtifacts | null {
  try {
    const rustdoc = JSON.parse(raw);
    const artifacts = emptyArtifacts();
    const items = rustdoc.items || rustdoc.paths || [];

    for (const item of items) {
      const name = item.name;
      if (!name) continue;
      const kind = item.kind || item.type;
      const doc = item.docs || item.desc;

      switch (kind) {
        case "function": case "fn":
          artifacts.functions.push({ label: name, kind: "function", detail: item.signature || `fn ${name}`, documentation: doc, module: packageName }); break;
        case "struct":
          artifacts.structs.push({ label: name, kind: "struct", detail: `struct ${name}`, documentation: doc, module: packageName }); break;
        case "enum":
          artifacts.enums.push({ label: name, kind: "enum", detail: `enum ${name}`, documentation: doc, module: packageName }); break;
        case "trait":
          artifacts.traits.push({ label: name, kind: "trait", detail: `trait ${name}`, documentation: doc, module: packageName }); break;
        case "const": case "constant":
          artifacts.constants.push({ label: name, kind: "constant", detail: `const ${name}`, documentation: doc, module: packageName }); break;
        case "type": case "typedef":
          artifacts.typeAliases.push({ label: name, kind: "typeAlias", detail: `type ${name}`, documentation: doc, module: packageName }); break;
      }
    }

    if (artifacts.functions.length > 0 || artifacts.structs.length > 0) {
      artifacts.imports.push({ path: packageName.replace(/-/g, "_"), name: packageName });
    }

    return artifacts;
  } catch {
    return null;
  }
}
