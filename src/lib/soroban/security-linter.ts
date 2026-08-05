/**
 * §13.9 — Soroban-specific security linting.
 *
 * Static checks for common Soroban smart contract vulnerabilities:
 *   1. Missing require_auth() on functions that take Address arguments
 *   2. Unchecked arithmetic (use checked_add/checked_sub instead of + / -)
 *   3. Missing input validation
 *   4. Cross-contract calls without auth checks (reentrancy risk)
 *
 * Results are surfaced as Monaco warnings/diagnostics.
 */

export interface SecurityLintResult {
  line: number;
  column: number;
  severity: "warning" | "error" | "info";
  rule: string;
  message: string;
  suggestion?: string;
}

export function lintSorobanSecurity(source: string): SecurityLintResult[] {
  const results: SecurityLintResult[] = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 1. Check for Address arguments without require_auth
    if (/pub\s+fn\s+\w+\s*\([^)]*Address/.test(line)) {
      // Look ahead in the function body for require_auth
      const fnBody = lines.slice(i, i + 30).join("\n");
      if (!fnBody.includes("require_auth")) {
        results.push({
          line: lineNum,
          column: line.indexOf("pub fn") + 1,
          severity: "warning",
          rule: "missing-require-auth",
          message: "Function takes Address argument but doesn't call require_auth()",
          suggestion: "Add `address.require_auth();` at the start of the function to prevent unauthorized calls.",
        });
      }
    }

    // 2. Check for unchecked arithmetic on i128/u128
    if (/\b(i128|u128)\b/.test(line) && /[+\-]\s*\w/.test(line) && !line.includes("checked_") && !line.includes("//")) {
      // Look for patterns like `a + b` or `a - b` on i128 values
      if (/\w+\s*[+\-]\s*\w+/.test(line) && !line.includes("let") && !line.includes("fn")) {
        results.push({
          line: lineNum,
          column: 1,
          severity: "info",
          rule: "unchecked-arithmetic",
          message: "Consider using checked_add/checked_sub to prevent overflow",
          suggestion: "Use `a.checked_add(b).expect(\"overflow\")` instead of `a + b`",
        });
      }
    }

    // 3. Check for env.storage().instance().set without checking existing value
    if (line.includes("env.storage().instance().set") && !line.includes("//")) {
      results.push({
        line: lineNum,
        column: 1,
        severity: "info",
        rule: "storage-set-pattern",
        message: "Direct storage set — consider checking authorization before writing",
        suggestion: "Ensure require_auth() is called before modifying storage.",
      });
    }

    // 4. Check for String::from_str without checking length
    if (line.includes("String::from_str") && !line.includes("//")) {
      results.push({
        line: lineNum,
        column: 1,
        severity: "info",
        rule: "string-length-check",
        message: "Consider validating string length before storing",
        suggestion: "Add `assert!(s.len() <= MAX_LEN, \"string too long\");`",
      });
    }

    // 5. Check for cross-contract calls without auth
    if (line.includes("env.invoke_contract") || line.includes("call_contract")) {
      const fnBody = lines.slice(Math.max(0, i - 10), i + 5).join("\n");
      if (!fnBody.includes("require_auth")) {
        results.push({
          line: lineNum,
          column: 1,
          severity: "warning",
          rule: "cross-contract-auth",
          message: "Cross-contract call without require_auth — potential reentrancy risk",
          suggestion: "Ensure the caller is authorized before cross-contract calls.",
        });
      }
    }

    // 6. Check for panic without message
    if (line.includes("panic!()") || line.includes("panic!()")) {
      results.push({
        line: lineNum,
        column: 1,
        severity: "info",
        rule: "bare-panic",
        message: "Bare panic without message — use `panic!(\"descriptive message\")` for better debugging",
      });
    }

    // 7. Check for TODO/FIXME comments
    if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(line)) {
      results.push({
        line: lineNum,
        column: line.indexOf("//") + 1,
        severity: "info",
        rule: "todo-comment",
        message: line.trim(),
      });
    }
  }

  return results;
}

/**
 * Convert lint results to Monaco marker data.
 */
export function lintResultsToMarkers(results: SecurityLintResult[]) {
  return results.map((r) => ({
    startLineNumber: r.line,
    startColumn: r.column,
    endLineNumber: r.line,
    endColumn: r.column + 50,
    message: r.message + (r.suggestion ? `\n\n💡 ${r.suggestion}` : ""),
    severity: r.severity === "error" ? 8 : r.severity === "warning" ? 4 : 2, // MarkerSeverity
    source: `soroban-lint:${r.rule}`,
  }));
}
