// Smoke test for the rewritten getAppKitForSigning logic.
// Verifies the function reads from window.__appkit first, then falls
// back to DOM elements. We can't run the full React component here, so
// we just verify the source code contains the expected logic.

const fs = require("fs");
const code = fs.readFileSync(
  "./src/components/ide/panels/right-panel.tsx",
  "utf8"
);

const checks = [
  ["reads window.__appkit first", code.includes(').__appkit')],
  ["checks typeof appkit.signTransaction === 'function'", code.includes("typeof appkit.signTransaction === \"function\"")],
  ["falls back to <stellar-appkit-modal>", code.includes('"stellar-appkit-modal"')],
  ["falls back to <saganta-appkit-modal>", code.includes('"saganta-appkit-modal"')],
  ["diagnostic console.warn present", code.includes('[deploy] wallet signing unavailable')],
  ["hints about WalletModalHost mount", code.includes("WalletModalHost")],
  ["user-facing error mentions F12 / browser console", code.includes("F12")],
];

let pass = 0, fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}`);
  if (ok) pass++; else fail++;
}

console.log(`\n${pass}/${checks.length} passed`);
process.exit(fail > 0 ? 1 : 0);
