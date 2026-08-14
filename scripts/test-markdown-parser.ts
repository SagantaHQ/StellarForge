// Smoke test: can we use unified + remark-parse to extract fenced code blocks
// from a Markdown string?
import { unified } from "unified";
import remarkParse from "remark-parse";

const markdown = `Here is the fix:

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 fn foo() {
-    let x = 5
+    let x = 5;
 }
\`\`\`

And another note:

\`\`\`rust
fn main() {}
\`\`\`
`;

const tree = unified().use(remarkParse).parse(markdown);

// Walk the tree, collect all 'code' nodes
const codeBlocks: { lang: string | null; value: string }[] = [];
function visit(node: any) {
  if (node.type === "code") {
    codeBlocks.push({ lang: node.lang ?? null, value: node.value ?? "" });
  }
  if (node.children) {
    for (const c of node.children) visit(c);
  }
}
visit(tree);

console.log(`Found ${codeBlocks.length} code blocks:`);
for (const [i, b] of codeBlocks.entries()) {
  console.log(`  [${i}] lang=${JSON.stringify(b.lang)}, ${b.value.length} chars`);
  console.log(`      first line: ${b.value.split("\n")[0]}`);
}
