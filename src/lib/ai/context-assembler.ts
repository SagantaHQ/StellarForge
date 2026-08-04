/**
 * §9.6 / §9.9 — Context assembler for the AI agent.
 *
 * On every request, include:
 *   1. System prompt (Soroban-specialized, built from the OZ skill)
 *   2. Cargo.toml (so the model knows dependency/feature setup)
 *   3. Contents of all locally-imported files (follow mod/import graph from active file)
 *   4. Knowledge-base summary (truncated if over budget)
 *
 * Hard token budget — never silently overflow. Show user a token-usage readout.
 * Priority order: current error/task → active file → import graph → Cargo.toml → knowledge.
 */

import type { ChatMessage } from "./providers";
import type { TreeNode, FileNode } from "@/lib/soroban/sample-project";
import { findFile, flattenFiles } from "@/lib/soroban/sample-project";

/** Rough token estimator — ~4 chars per token for English/code */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Soroban-specialized system prompt (§9.3). */
export const SOROBAN_SYSTEM_PROMPT = `You are the Soroban.Build AI agent — a senior Soroban smart contract engineer.

Your expertise:
- Soroban SDK (Rust) — contract, contractimpl, contracttype, contracterror macros
- Stellar network — accounts, payments, transactions, sequence numbers
- Best practices — require_auth on all address args, instance vs persistent storage, env.storage() patterns
- Security — reentrancy via cross-contract calls, unchecked arithmetic, missing auth checks
- The Cargo workspace layout with cdylib crate-type and wasm32v1-none target

When you propose a code change:
- Output a fenced diff using \`\`\`diff blocks with proper --- / +++ / @@ markers
- Only touch code within the active scope (Smart Contract / UI / General)
- Always explain WHY the change fixes the issue or improves the code — teach, don't just patch
- Prefer minimal diffs; do not refactor unrelated code unless explicitly asked

When you respond:
- Be concise — no preamble, no restating the question
- If the user's code is missing require_auth or has obvious security issues, call it out first
- Reference Stellar/Soroban docs (https://developers.stellar.org/docs/build) when linking concepts
- If you're uncertain, say so explicitly — do not invent APIs

You are running inside the Soroban.Build IDE. The user will see your proposed diff and must approve it before it's applied.`;

export interface AssembledContext {
  messages: ChatMessage[];
  tokenUsage: {
    system: number;
    cargoToml: number;
    activeFile: number;
    imports: number;
    knowledge: number;
    total: number;
    budget: number;
  };
  filesIncluded: string[];
  truncated: boolean;
}

interface AssembleOptions {
  tree: TreeNode[];
  activeFilePath: string | null;
  userMessage: string;
  /** Optional error context (from "Fix with AI" terminal button) */
  errorContext?: string;
  /** Scope — limits which files are pulled into context (§9.8) */
  scope?: "smart-contract" | "ui-frontend" | "general" | "custom";
  customScopePaths?: string[];
  /** Hard token budget — context is truncated to fit */
  budget?: number;
  /** Knowledge-base summary (pre-built, not chunked here) */
  knowledgeSummary?: string;
}

/**
 * Follow the Rust mod / use import graph from the active file to find
 * locally-imported files in the project tree.
 */
function findImportedFiles(tree: TreeNode[], activeFile: FileNode): FileNode[] {
  const allFiles = flattenFiles(tree);
  const imported: FileNode[] = [];
  const seen = new Set<string>([activeFile.path]);

  // Match `mod foo;` and `use crate::foo::bar;` patterns
  const modPattern = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;
  const usePattern = /^\s*use\s+(?:crate::|super::|self::)?([\w:]+)\s*;/gm;

  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = modPattern.exec(activeFile.content)) !== null) {
    matches.push(m[1]);
  }
  while ((m = usePattern.exec(activeFile.content)) !== null) {
    matches.push(m[1].split("::")[0]);
  }

  // Look for sibling files named like `foo.rs` or `foo/mod.rs`
  const activeDir = activeFile.path.includes("/")
    ? activeFile.path.substring(0, activeFile.path.lastIndexOf("/"))
    : "";

  for (const modName of matches) {
    const candidates = [
      activeDir ? `${activeDir}/${modName}.rs` : `${modName}.rs`,
      activeDir ? `${activeDir}/${modName}/mod.rs` : `${modName}/mod.rs`,
      `${modName}.rs`,
      `${modName}/mod.rs`,
    ];
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      const file = allFiles.find((f) => f.path === candidate);
      if (file) {
        imported.push(file);
        seen.add(file.path);
        break;
      }
    }
  }

  return imported;
}

/**
 * Assemble the full context for an AI request, respecting the hard token budget.
 *
 * Priority order (lowest-priority truncated first):
 *   1. System prompt (always included)
 *   2. User message (always included)
 *   3. Error context (if present)
 *   4. Active file (always included)
 *   5. Cargo.toml (always included if present)
 *   6. Imported files (highest-priority first)
 *   7. Knowledge summary (truncated first)
 */
export function assembleContext(opts: AssembleOptions): AssembledContext {
  const budget = opts.budget ?? 32000;
  const scope = opts.scope ?? "general";
  const filesIncluded: string[] = [];
  let truncated = false;

  const usage = {
    system: 0,
    cargoToml: 0,
    activeFile: 0,
    imports: 0,
    knowledge: 0,
    total: 0,
    budget,
  };

  // 1. System prompt — always included
  const systemMsg: ChatMessage = {
    role: "system",
    content: SOROBAN_SYSTEM_PROMPT,
  };
  usage.system = estimateTokens(systemMsg.content);

  // 2. User message — always included
  let userContent = opts.userMessage;

  // 3. Error context — prepended if present (§9.7 "Fix with AI")
  if (opts.errorContext) {
    userContent = `Build error:\n\`\`\`\n${opts.errorContext}\n\`\`\`\n\n${userContent}`;
  }

  // 4. Active file
  let activeFileContent = "";
  if (opts.activeFilePath) {
    const file = findFile(opts.tree, opts.activeFilePath);
    if (file) {
      // §9.8 — scope enforcement: smart-contract tabs only pull Rust sources
      const isRust = file.language === "rust";
      const isUi = file.path.startsWith("ui/") || file.language === "typescript";
      const includeByScope =
        scope === "general" ||
        (scope === "smart-contract" && isRust) ||
        (scope === "ui-frontend" && isUi) ||
        (scope === "custom" && opts.customScopePaths?.includes(file.path));

      if (includeByScope) {
        activeFileContent = `--- Active file: ${file.path} ---\n\`\`\`${file.language}\n${file.content}\n\`\`\`\n`;
        filesIncluded.push(file.path);
        usage.activeFile = estimateTokens(activeFileContent);
      }
    }
  }

  // 5. Cargo.toml
  let cargoContent = "";
  const cargoFile = flattenFiles(opts.tree).find((f) => f.name === "Cargo.toml");
  if (cargoFile) {
    cargoContent = `--- Cargo.toml ---\n\`\`\`toml\n${cargoFile.content}\n\`\`\`\n`;
    usage.cargoToml = estimateTokens(cargoContent);
  }

  // 6. Imported files
  let importsContent = "";
  if (opts.activeFilePath) {
    const activeFile = findFile(opts.tree, opts.activeFilePath);
    if (activeFile) {
      const importedFiles = findImportedFiles(opts.tree, activeFile);
      for (const imp of importedFiles) {
        const impText = `--- ${imp.path} ---\n\`\`\`${imp.language}\n${imp.content}\n\`\`\`\n`;
        const impTokens = estimateTokens(impText);
        // Check budget before adding
        const usedSoFar =
          usage.system + usage.activeFile + usage.cargoToml + usage.imports + estimateTokens(userContent);
        if (usedSoFar + impTokens > budget - 2000) {
          // Reserve 2k for knowledge summary + response
          truncated = true;
          break;
        }
        importsContent += impText;
        usage.imports += impTokens;
        filesIncluded.push(imp.path);
      }
    }
  }

  // 7. Knowledge summary (truncated first if over budget)
  let knowledgeContent = "";
  if (opts.knowledgeSummary) {
    const kTokens = estimateTokens(opts.knowledgeSummary);
    const usedSoFar =
      usage.system + usage.activeFile + usage.cargoToml + usage.imports + estimateTokens(userContent);
    const remaining = budget - usedSoFar - 1000; // reserve 1k for response
    if (kTokens > remaining) {
      // Truncate knowledge summary
      const charBudget = remaining * 4;
      knowledgeContent = `--- Knowledge summary (truncated) ---\n${opts.knowledgeSummary.substring(0, charBudget)}…\n`;
      truncated = true;
    } else {
      knowledgeContent = `--- Knowledge summary ---\n${opts.knowledgeSummary}\n`;
    }
    usage.knowledge = estimateTokens(knowledgeContent);
  }

  // Assemble final user message
  const finalUserContent = [
    knowledgeContent,
    cargoContent,
    activeFileContent,
    importsContent,
    "",
    "User request:",
    userContent,
  ].filter(Boolean).join("\n");

  const userMsg: ChatMessage = {
    role: "user",
    content: finalUserContent,
  };

  usage.total =
    usage.system +
    usage.activeFile +
    usage.cargoToml +
    usage.imports +
    usage.knowledge +
    estimateTokens(finalUserContent);

  return {
    messages: [systemMsg, userMsg],
    tokenUsage: usage,
    filesIncluded,
    truncated,
  };
}

/**
 * Parse a model response and extract any fenced diff blocks.
 * Used by the diff-approval flow (§9.5).
 */
export interface ParsedDiff {
  filePath: string;
  hunks: { oldStart: number; newStart: number; lines: string[] }[];
  raw: string;
}

export function parseDiffFromResponse(content: string): ParsedDiff[] {
  const diffs: ParsedDiff[] = [];
  const diffBlockPattern = /```diff\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = diffBlockPattern.exec(content)) !== null) {
    const raw = m[1];
    const filePathMatch = raw.match(/^\+\+\+ b\/(.+)$/m);
    const filePath = filePathMatch ? filePathMatch[1] : "(unknown file)";
    const hunkPattern = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@\n([\s\S]*?)(?=\n@@|\n```|$)/g;
    const hunks: ParsedDiff["hunks"] = [];
    let h: RegExpExecArray | null;
    while ((h = hunkPattern.exec(raw)) !== null) {
      hunks.push({
        oldStart: parseInt(h[1], 10),
        newStart: parseInt(h[2], 10),
        lines: h[3].split("\n").filter((l) => l.length > 0),
      });
    }
    diffs.push({ filePath, hunks, raw });
  }
  return diffs;
}
