import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const root = mkdtempSync(join(tmpdir(), "whale-persona-retired-"));
const builtinDir = join(root, "builtin");
const dataDir = join(root, "data");

process.env.WHALE_DATA_DIR = dataDir;
process.env.WHALE_USER_PERSONA_DIR = join(dataDir, "personas");
process.env.WHALE_PERSONA_DIR = builtinDir;

mkdirSync(builtinDir, { recursive: true });

const { ensurePersonaLayout } = await import("../src/core/persona-store.js");

test("启动时会清掉已下线的内置人格卡", () => {
  writeFileSync(
    join(builtinDir, "tsundere-assistant.md"),
    "# 傲娇助手\n",
    "utf8",
  );
  writeFileSync(
    join(builtinDir, "deepseek-whale.md"),
    "# 角色卡：DeepSeek 小鲸鱼\n",
    "utf8",
  );

  ensurePersonaLayout();

  assert.equal(existsSync(join(builtinDir, "tsundere-assistant.md")), false);
  assert.equal(existsSync(join(builtinDir, "deepseek-whale.md")), true);
});

test.after(() => {
  rmSync(root, { recursive: true, force: true });
});
