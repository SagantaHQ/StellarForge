// Smoke test for the contract ID extraction logic + invoke endpoint.
//
// We can't run a real deploy in this test (no funded wallet), but we
// can verify the function shape + the key methods exist on the SDK.

const fs = require("fs");

const checks = [];

// Check 1: submit route has the new TransactionResult-based extraction
const submitCode = fs.readFileSync(
  "./src/app/api/contracts/submit/route.ts",
  "utf8"
);
checks.push([
  "submit uses brute-force CONTRACT_ID_RE regex (replaces structured walk)",
  submitCode.includes("CONTRACT_ID_RE") && submitCode.includes("C[A-Z2-7]{55}"),
]);
checks.push([
  "submit validates candidates via new Address(strkey)",
  submitCode.includes("new Address(candidate)"),
]);
checks.push([
  "submit searches decoded base64 XDR bytes",
  submitCode.includes('Buffer.from(val, "base64")'),
]);
checks.push([
  "submit searches parsed XDR JSON (TransactionResult + TransactionMeta + TransactionEnvelope)",
  submitCode.includes("xdr.TransactionResult") &&
  submitCode.includes("xdr.TransactionMeta") &&
  submitCode.includes("xdr.TransactionEnvelope"),
]);
checks.push([
  "submit surfaces DB persistence errors (was silently caught)",
  submitCode.includes('failed to persist deploy record') &&
  !submitCode.includes(".catch((err) => {")  // old silent catch removed
    || submitCode.includes("console.error"),
]);
checks.push([
  "submit handles phase='invoke'",
  submitCode.includes('"invoke"') && submitCode.includes("phase"),
]);
checks.push([
  "submit returns debug info when extraction fails",
  submitCode.includes("extractionFailed: true") && submitCode.includes("extractionDebug"),
]);
checks.push([
  "submit includes hint with tx-hash explorer link when extraction fails",
  submitCode.includes("stellarchain.io/tx/") && submitCode.includes("hint"),
]);

// Check 2: invoke endpoint exists with the right shape
const invokeCode = fs.readFileSync(
  "./src/app/api/contracts/invoke/route.ts",
  "utf8"
);
checks.push([
  "invoke route exists",
  invokeCode.length > 1000,
]);
checks.push([
  "invoke route has POST export",
  invokeCode.includes("export async function POST"),
]);
checks.push([
  "invoke route supports read mode (simulate)",
  invokeCode.includes('mode === "read"') && invokeCode.includes("simulateTransaction"),
]);
checks.push([
  "invoke route supports write mode (build tx)",
  invokeCode.includes('mode === "write"') && invokeCode.includes("prepareTransaction"),
]);
checks.push([
  "invoke route handles Address type marker",
  invokeCode.includes('__type === "address"') && invokeCode.includes("addr.toScVal()"),
]);

// Check 3: contract interaction panel uses the new endpoint
const panelCode = fs.readFileSync(
  "./src/components/ide/panels/contract-interaction.tsx",
  "utf8"
);
checks.push([
  "panel uses /api/contracts/invoke (not /api/terminal)",
  panelCode.includes("/api/contracts/invoke") && !panelCode.includes("/api/terminal"),
]);
checks.push([
  "panel has Query (read) button",
  panelCode.includes("onQuery") && panelCode.includes("Query"),
]);
checks.push([
  "panel has Transact (write) button",
  panelCode.includes("onTransact") && panelCode.includes("Transact"),
]);
checks.push([
  "panel accepts network prop",
  panelCode.includes("network =") && panelCode.includes("network}"),
]);
checks.push([
  "panel shows pending-sign state",
  panelCode.includes("pendingSign"),
]);

// Check 4: right-panel uses stellarchain.io (not stellar.expert)
const rightPanelCode = fs.readFileSync(
  "./src/components/ide/panels/right-panel.tsx",
  "utf8"
);
checks.push([
  "right-panel uses stellarchain.io",
  rightPanelCode.includes("stellarchain.io"),
]);
checks.push([
  "right-panel uses testnet.stellarchain.io for testnet",
  rightPanelCode.includes("testnet.stellarchain.io"),
]);
checks.push([
  "right-panel no longer uses stellar.expert",
  !rightPanelCode.includes("stellar.expert"),
]);
checks.push([
  "right-panel passes network to ContractInteractionPanel",
  rightPanelCode.includes("network={network}") &&
    rightPanelCode.includes("ContractInteractionPanel"),
]);
checks.push([
  "right-panel surfaces DB warning from server",
  rightPanelCode.includes("createResult.warning"),
]);

// Check 5: upgrade confirmation modal
checks.push([
  "right-panel has showUpgradeConfirm state",
  rightPanelCode.includes("showUpgradeConfirm"),
]);
checks.push([
  "right-panel shows AlertDialog modal when re-deploying existing contract",
  rightPanelCode.includes("<AlertDialog") &&
  rightPanelCode.includes("AlertDialogContent") &&
  rightPanelCode.includes("AlertDialogAction"),
]);
checks.push([
  "right-panel handleDeploy checks existingContract before proceeding",
  rightPanelCode.includes("if (existingContract)") &&
  rightPanelCode.includes("setShowUpgradeConfirm(true)"),
]);
checks.push([
  "right-panel extracts performDeploy() from handleDeploy",
  rightPanelCode.includes("async function performDeploy()"),
]);
checks.push([
  "right-panel modal calls performDeploy on confirm",
  rightPanelCode.includes('onClick={() => performDeploy()}'),
]);
checks.push([
  "right-panel modal shows existing contract ID",
  rightPanelCode.includes("existingContract?.contractId"),
]);
checks.push([
  "right-panel modal warns about WASM replacement + contract ID stability",
  rightPanelCode.includes("replace the contract's WASM") &&
  rightPanelCode.includes("contract ID stays the same"),
]);
checks.push([
  "right-panel success card shows tx-hash explorer link (always, even if contract ID missing)",
  rightPanelCode.includes("View transaction on stellarchain.io"),
]);
checks.push([
  "right-panel success card conditionally shows contract explorer link (only when contractId is present)",
  rightPanelCode.includes("success.contractId ? (") &&
  rightPanelCode.includes("Contract ID not yet available"),
]);
checks.push([
  "right-panel imports AlertDialog from shadcn/ui",
  rightPanelCode.includes('AlertDialog') &&
  rightPanelCode.includes('from "@/components/ui/alert-dialog"'),
]);

let pass = 0, fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}`);
  if (ok) pass++; else fail++;
}

console.log(`\n${pass}/${checks.length} passed`);
process.exit(fail > 0 ? 1 : 0);
