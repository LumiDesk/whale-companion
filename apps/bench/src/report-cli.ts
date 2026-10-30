import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { buildReport } from "./report.js";
import type { IRun } from "./types.js";

const argOf = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const target = argOf("run") ?? argOf("results");

if (!target) {
  console.error(
    "用法：pnpm --filter @apps/bench report -- --run <runDir|results.json>",
  );
  process.exit(1);
}

const resolved = resolve(process.cwd(), target);
const jsonPath = resolved.endsWith(".json")
  ? resolved
  : join(resolved, "results.json");

const run = JSON.parse(readFileSync(jsonPath, "utf8")) as IRun;
const report = buildReport(run);
const runDir = dirname(jsonPath);

writeFileSync(join(runDir, "report.html"), report.html, "utf8");
writeFileSync(join(runDir, "report.md"), report.markdown, "utf8");

console.log(`报告已重建：${join(runDir, "report.html")}`);
