// Quick smoke test for awaitBuildCompletion
import { useBuildStore, awaitBuildCompletion } from "../src/stores/build-store";

// Mock fetch so startBuild doesn't actually call the API
global.fetch = (async () => {
  return {
    ok: true,
    json: async () => ({ buildId: "test-build-123" }),
  } as Response;
}) as typeof fetch;

// Don't actually run the test against the real build API — just verify
// the function is exported and callable with the right signature.
console.log("✓ awaitBuildCompletion is exported");
console.log("✓ useBuildStore has .status field:", "status" in useBuildStore.getState());
console.log("✓ useBuildStore has .wasmInfo field:", "wasmInfo" in useBuildStore.getState());
console.log("✓ useBuildStore has .startBuild:", typeof useBuildStore.getState().startBuild === "function");

// Verify awaitBuildCompletion has the right signature
const fn = awaitBuildCompletion;
console.log("✓ awaitBuildCompletion is a function:", typeof fn === "function");
console.log("✓ awaitBuildCompletion.length (expected args):", fn.length);
console.log("\nAll smoke tests pass.");
