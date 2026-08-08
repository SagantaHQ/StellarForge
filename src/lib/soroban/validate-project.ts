/**
 * Soroban project validation.
 *
 * Checks whether a set of imported files constitutes a valid Soroban
 * smart contract project. A valid Soroban project MUST have:
 *
 *   1. A `Cargo.toml` file at the root (or in a subdirectory — we check
 *      all Cargo.toml files found)
 *   2. The Cargo.toml must list `soroban-sdk` as a dependency
 *   3. The Cargo.toml must have `crate-type = ["cdylib"]` in the [lib] section
 *   4. At least one `.rs` source file (typically src/lib.rs)
 *
 * If any of these checks fail, the import is rejected with a descriptive
 * error message explaining what's missing.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** The Cargo.toml file path that was validated (if found) */
  cargoTomlPath?: string;
  /** The detected project name from Cargo.toml */
  projectName?: string;
  /** The detected soroban-sdk version */
  sorobanSdkVersion?: string;
}

export interface ImportedFile {
  path: string;
  content: string;
  language: string;
}

/**
 * Validate that the given files constitute a Soroban smart contract project.
 */
export function validateSorobanProject(files: ImportedFile[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Find all Cargo.toml files
  const cargoTomlFiles = files.filter(
    (f) => f.path === "Cargo.toml" || f.path.endsWith("/Cargo.toml")
  );

  if (cargoTomlFiles.length === 0) {
    errors.push(
      "No Cargo.toml found. A Soroban project requires a Cargo.toml file at the root."
    );
    return { valid: false, errors, warnings };
  }

  // Prefer the root-level Cargo.toml; if none, use the first one found
  const rootCargoToml = cargoTomlFiles.find((f) => f.path === "Cargo.toml");
  const cargoToml = rootCargoToml ?? cargoTomlFiles[0];
  const cargoContent = cargoToml.content;

  // 2. Check for soroban-sdk dependency
  const hasSorobanSdk = /^\s*soroban-sdk\s*=/m.test(cargoContent);
  if (!hasSorobanSdk) {
    errors.push(
      "Cargo.toml does not list 'soroban-sdk' as a dependency. " +
        "Soroban contracts require the soroban-sdk crate."
    );
  }

  // Extract soroban-sdk version for info
  const sdkVersionMatch = cargoContent.match(
    /soroban-sdk\s*=\s*(?:"([^"]+)"|version\s*=\s*"([^"]+)")/
  );
  const sorobanSdkVersion = sdkVersionMatch?.[1] ?? sdkVersionMatch?.[2];

  // 3. Check for cdylib crate-type
  const hasCdylib = /crate-type\s*=\s*\[.*"cdylib".*\]/.test(cargoContent);
  if (!hasCdylib) {
    errors.push(
      "Cargo.toml is missing 'crate-type = [\"cdylib\"]' in the [lib] section. " +
        "Soroban contracts must be compiled as cdylib."
    );
  }

  // Extract project name from [package] section
  const nameMatch = cargoContent.match(/^name\s*=\s*"([^"]+)"/m);
  const projectName = nameMatch?.[1];

  // 4. Check for at least one .rs source file
  const rustFiles = files.filter(
    (f) => f.path.endsWith(".rs") && !f.path.endsWith("/test.rs")
  );
  if (rustFiles.length === 0) {
    errors.push(
      "No Rust source files (.rs) found. A Soroban contract needs at least " +
        "one .rs file (typically src/lib.rs)."
    );
  }

  // Warnings (non-blocking)
  if (cargoTomlFiles.length > 1) {
    warnings.push(
      `Multiple Cargo.toml files found (${cargoTomlFiles.length}). ` +
        `Using "${cargoToml.path}" as the project root.`
    );
  }

  // Check for src/lib.rs specifically
  const hasLibRs = files.some((f) => f.path === "src/lib.rs");
  if (!hasLibRs && rustFiles.length > 0) {
    warnings.push(
      "No src/lib.rs found. The contract entry point is typically src/lib.rs."
    );
  }

  // Check for overflow-checks (stellar-cli 27+ requirement)
  const hasOverflowChecks = /overflow-checks\s*=\s*true/.test(cargoContent);
  if (!hasOverflowChecks) {
    warnings.push(
      "Cargo.toml does not set 'overflow-checks = true'. " +
        "This is required by stellar-cli 27+ for release builds."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    cargoTomlPath: cargoToml.path,
    projectName,
    sorobanSdkVersion,
  };
}

/**
 * Generate a human-readable summary of the validation result.
 * Used to display in the import modal after validation.
 */
export function formatValidationResult(result: ValidationResult): string {
  if (result.valid) {
    let summary = "Valid Soroban project";
    if (result.projectName) summary += `: ${result.projectName}`;
    if (result.sorobanSdkVersion) summary += ` (soroban-sdk ${result.sorobanSdkVersion})`;
    return summary;
  }
  return `Invalid Soroban project: ${result.errors[0]}`;
}
