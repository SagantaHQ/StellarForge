/**
 * Cargo.toml parser + editor utilities.
 *
 * Simple regex-based parser for the [dependencies] and [dev-dependencies]
 * sections of a Cargo.toml file. Not a full TOML parser — just enough to
 * list, add, and remove dependencies from Soroban contract projects.
 *
 * Note: `dev_dependencies` (underscore) is deprecated in the 2024 edition;
 * `dev-dependencies` (hyphen) is the canonical form. Both are accepted on
 * parse for backwards compat, but we always emit the hyphen form.
 */

export interface CargoDependency {
  name: string;
  version: string;
  /** Whether this is a dev dependency ([dev-dependencies]) or regular ([dependencies]) */
  dev: boolean;
  /** Full line from the original file (for removal) */
  rawLine: string;
}

/**
 * Parse all dependencies from a Cargo.toml string.
 * Returns an array of { name, version, dev } entries.
 */
export function parseDependencies(cargoTomlContent: string): CargoDependency[] {
  const deps: CargoDependency[] = [];
  const lines = cargoTomlContent.split("\n");

  let currentSection: "dependencies" | "dev-dependencies" | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section headers (accept both hyphen and underscore forms)
    if (trimmed === "[dependencies]") {
      currentSection = "dependencies";
      continue;
    }
    if (trimmed === "[dev-dependencies]" || trimmed === "[dev_dependencies]") {
      currentSection = "dev-dependencies";
      continue;
    }
    // Any other section header → stop parsing deps
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      currentSection = null;
      continue;
    }

    if (!currentSection) continue;

    // Match dependency lines:
    //   name = "version"
    //   name = { version = "1.0", features = ["test"] }
    const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
    const tableMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);

    const match = simpleMatch || tableMatch;
    if (match) {
      deps.push({
        name: match[1],
        version: match[2],
        dev: currentSection === "dev-dependencies",
        rawLine: line,
      });
    }
  }

  return deps;
}

/**
 * Add a dependency to a Cargo.toml string.
 * If the dependency already exists, it's updated with the new version.
 * Returns the modified Cargo.toml content.
 */
export function addDependency(
  cargoTomlContent: string,
  name: string,
  version: string,
  dev: boolean = false
): string {
  // Always emit the canonical hyphen form ([dev-dependencies], not [dev_dependencies])
  const section = dev ? "[dev-dependencies]" : "[dependencies]";
  const lines = cargoTomlContent.split("\n");

  // Check if the dependency already exists (in either section)
  const existingDeps = parseDependencies(cargoTomlContent);
  const existing = existingDeps.find((d) => d.name === name);

  if (existing) {
    // Update the version in-place
    return cargoTomlContent.replace(
      existing.rawLine,
      existing.rawLine.replace(/"[^"]+"/, `"${version}"`)
    );
  }

  // Find the target section, or create it if it doesn't exist
  let sectionIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === section) {
      sectionIdx = i;
      break;
    }
  }

  const newLine = `${name} = "${version}"`;

  if (sectionIdx >= 0) {
    // Insert after the section header, before the next section or blank line
    let insertIdx = sectionIdx + 1;
    while (
      insertIdx < lines.length &&
      lines[insertIdx].trim() !== "" &&
      !lines[insertIdx].trim().startsWith("[")
    ) {
      insertIdx++;
    }
    lines.splice(insertIdx, 0, newLine);
  } else {
    // Section doesn't exist — add it at the end
    lines.push("");
    lines.push(section);
    lines.push(newLine);
  }

  return lines.join("\n");
}

/**
 * Remove a dependency from a Cargo.toml string.
 * Returns the modified Cargo.toml content.
 */
export function removeDependency(
  cargoTomlContent: string,
  name: string
): string {
  const lines = cargoTomlContent.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match the dependency name at the start of the line
    const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=/);
    if (match && match[1] === name) {
      // Skip this line (remove the dependency)
      continue;
    }
    result.push(line);
  }

  return result.join("\n");
}

/**
 * Find the Cargo.toml file in the file tree.
 * Returns the file content, or null if not found.
 */
export function findCargoToml(
  files: { path: string; content: string }[]
): { path: string; content: string } | null {
  const cargoFile =
    files.find((f) => f.path === "Cargo.toml") ??
    files.find((f) => f.path.endsWith("/Cargo.toml"));
  return cargoFile ?? null;
}
