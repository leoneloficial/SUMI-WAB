import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const TARGETS = [
  {
    file: path.join(ROOT, "node_modules", "whatwg-url", "lib", "url-state-machine.js"),
    from: 'require("punycode")',
    to: 'require("punycode/")',
  },
  {
    file: path.join(ROOT, "node_modules", "tr46", "index.js"),
    from: 'require("punycode")',
    to: 'require("punycode/")',
  },
];

let patchedCount = 0;

for (const target of TARGETS) {
  if (!fs.existsSync(target.file)) {
    continue;
  }

  const original = fs.readFileSync(target.file, "utf8");
  if (original.includes(target.to)) {
    continue;
  }

  if (!original.includes(target.from)) {
    continue;
  }

  const next = original.replace(target.from, target.to);
  if (next === original) {
    continue;
  }

  fs.writeFileSync(target.file, next);
  patchedCount += 1;
}

if (patchedCount > 0) {
  console.log(`[postinstall] patch-punycode: ${patchedCount} archivo(s) ajustados.`);
} else {
  console.log("[postinstall] patch-punycode: sin cambios.");
}
