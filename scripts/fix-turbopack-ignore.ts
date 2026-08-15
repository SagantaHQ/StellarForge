// Fix script: add turbopackIgnore comments to all dynamic fs calls in API routes
// This prevents Next.js from tracing the entire /tmp directory during build.

const fs = require("fs");
const path = require("path");

const FILES = [
  "src/app/api/build/route.ts",
  "src/app/api/build/diagnose/route.ts",
  "src/app/api/terminal/route.ts",
  "src/app/api/contracts/deploy-tx/route.ts",
  "src/app/api/autocomplete/build-deps/route.ts",
  "src/app/api/autocomplete/rustdoc-index/route.ts",
];

// Patterns to fix — each entry is [regex, replacement]
// We wrap the path argument with /*turbopackIgnore: true*/
const FIXES = [
  // fs.stat(path) → fs.stat(/*turbopackIgnore: true*/ path)
  [/\bfs\.stat\((?!\/\*turbopackIgnore)/g, "fs.stat(/*turbopackIgnore: true*/ "],
  // fs.readFile(path) → fs.readFile(/*turbopackIgnore: true*/ path)
  [/\bfs\.readFile\((?!\/\*turbopackIgnore)/g, "fs.readFile(/*turbopackIgnore: true*/ "],
  // fs.writeFile(path) → fs.writeFile(/*turbopackIgnore: true*/ path)
  [/\bfs\.writeFile\((?!\/\*turbopackIgnore)/g, "fs.writeFile(/*turbopackIgnore: true*/ "],
  // fs.readdir(path) → fs.readdir(/*turbopackIgnore: true*/ path)
  [/\bfs\.readdir\((?!\/\*turbopackIgnore)/g, "fs.readdir(/*turbopackIgnore: true*/ "],
  // fs.mkdir(path) → fs.mkdir(/*turbopackIgnore: true*/ path)
  [/\bfs\.mkdir\((?!\/\*turbopackIgnore)/g, "fs.mkdir(/*turbopackIgnore: true*/ "],
  // fs.unlink(path) → fs.unlink(/*turbopackIgnore: true*/ path)
  [/\bfs\.unlink\((?!\/\*turbopackIgnore)/g, "fs.unlink(/*turbopackIgnore: true*/ "],
  // fs.copyFile(path) → fs.copyFile(/*turbopackIgnore: true*/ path)
  [/\bfs\.copyFile\((?!\/\*turbopackIgnore)/g, "fs.copyFile(/*turbopackIgnore: true*/ "],
  // readFile(path) (imported from fs/promises) → readFile(/*turbopackIgnore: true*/ path)
  [/\breadFile\((?!\/\*turbopackIgnore)/g, "readFile(/*turbopackIgnore: true*/ "],
  // readdir(dir) (imported from fs/promises) → readdir(/*turbopackIgnore: true*/ dir)
  [/\breaddir\((?!\/\*turbopackIgnore)/g, "readdir(/*turbopackIgnore: true*/ "],
  // existsSync(path) → existsSync(/*turbopackIgnore: true*/ path)
  [/\bexistsSync\((?!\/\*turbopackIgnore)/g, "existsSync(/*turbopackIgnore: true*/ "],
];

let totalFixed = 0;

for (const file of FILES) {
  const fullPath = path.join(__dirname, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`SKIP (not found): ${file}`);
    continue;
  }

  let content = fs.readFileSync(fullPath, "utf-8");
  let changed = false;

  for (const [regex, replacement] of FIXES) {
    const matches = content.match(regex);
    if (matches) {
      content = content.replace(regex, replacement);
      changed = true;
      totalFixed += matches.length;
    }
  }

  if (changed) {
    fs.writeFileSync(fullPath, content);
    console.log(`FIXED: ${file}`);
  } else {
    console.log(`OK (no changes): ${file}`);
  }
}

console.log(`\nTotal fixes: ${totalFixed}`);
