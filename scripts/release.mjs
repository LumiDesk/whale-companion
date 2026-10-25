#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const type = args.find((arg) => !arg.startsWith("-"));
const allowed = ["patch", "minor", "major"];

if (!type || !allowed.includes(type)) {
  console.error("用法：pnpm release <patch|minor|major> [--dry-run]");
  process.exit(1);
}

const versionFiles = [
  "package.json",
  "apps/server/package.json",
  "apps/desktop/package.json",
  "apps/desktop/neutralino.config.json",
];

const readJson = (file) =>
  JSON.parse(readFileSync(join(root, file), "utf8"));

const writeJson = (file, data) =>
  writeFileSync(join(root, file), `${JSON.stringify(data, null, 2)}\n`, "utf8");

const bumpVersion = (version, kind) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`当前版本号不是 x.y.z：${version}`);

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (kind === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
};

const current = readJson("package.json").version;
const next = bumpVersion(current, type);
const tag = `v${next}`;

console.log(`版本：${current} -> ${next}`);
console.log(`标签：${tag}`);
console.log("将更新：");
for (const file of versionFiles) console.log(`  - ${file}`);

if (dryRun) {
  console.log("\n--dry-run：不改文件、不提交、不推送");
  process.exit(0);
}

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw new Error(`${command} 无法执行：${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} 退出码 ${result.status}`);
  }
};

const capture = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`${command} 无法执行：${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${command} ${commandArgs.join(" ")} 失败：${detail}`);
  }

  return result.stdout.trim();
};

try {
  const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    throw new Error(`当前在 ${branch} 分支，请先切到 main`);
  }

  if (capture("git", ["status", "--porcelain"])) {
    throw new Error("工作区不干净，请先提交或 stash");
  }

  const remote = capture("git", ["remote", "get-url", "origin"]);
  console.log(`远程：${remote}`);

  run("git", ["fetch", "origin", "--tags"]);
  run("git", ["pull", "--ff-only", "origin", "main"]);

  if (capture("git", ["tag", "--list", tag])) {
    throw new Error(`本地已存在 tag ${tag}`);
  }
  if (capture("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`])) {
    throw new Error(`远程已存在 tag ${tag}`);
  }

  console.log("\n运行 typecheck 和单测…");
  run("pnpm", ["typecheck"], { shell: true });
  run("pnpm", ["test"], { shell: true });

  for (const file of versionFiles) {
    const data = readJson(file);
    data.version = next;
    writeJson(file, data);
  }

  // 版本变化通常不影响 lockfile，但带上它避免 pnpm 需要同步时漏提交
  run("git", ["add", ...versionFiles, "pnpm-lock.yaml"]);
  run("git", ["commit", "-m", `chore: release ${tag}`]);
  run("git", ["tag", "-a", tag, "-m", tag]);

  try {
    run("git", ["push", "origin", "main"]);
    run("git", ["push", "origin", tag]);
  } catch (error) {
    console.error(`\n本地提交和 tag 已创建，但推送失败：${error.message}`);
    console.error(`手动重试：git push origin main && git push origin ${tag}`);
    process.exit(1);
  }

  console.log(`\n已推送 ${tag}。CI 会构建便携包并创建 GitHub Release。`);

  const github = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
  if (github) {
    console.log(
      `Actions: https://github.com/${github[1]}/${github[2]}/actions/workflows/desktop.yml`,
    );
  }
} catch (error) {
  console.error(`\n发版中止：${error.message}`);
  process.exit(1);
}
