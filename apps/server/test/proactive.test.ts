import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";
process.env.PROACTIVE_QUIET_START = "0";
process.env.PROACTIVE_QUIET_END = "0";

const dataDir = mkdtempSync(join(tmpdir(), "whale-proactive-"));
process.env.WHALE_DATA_DIR = dataDir;
mkdirSync(dataDir, { recursive: true });

const now = Date.now();
writeFileSync(
  join(dataDir, "users.json"),
  JSON.stringify([
    {
      userId: "u1",
      channel: "qq",
      lastSeen: now - 60 * 60 * 1000,
      nextWakeAt: now - 1000,
      wakeIntent: "想问问他面试怎么样",
      wakeAllowSilent: true,
    },
  ]),
  "utf8",
);

const { runProactiveNow } = await import("../src/core/proactive.js");

test("显式 wake 到点后跑 proactive 回合并清掉唤醒", async () => {
  const calls: Array<{
    userId: string;
    intent: string;
    allowSilent: boolean;
  }> = [];

  await runProactiveNow(async (userId, intent, _afterMinutes, allowSilent) => {
    calls.push({ userId, intent, allowSilent });
    return true;
  });

  assert.deepEqual(calls, [
    {
      userId: "u1",
      intent: "想问问他面试怎么样",
      allowSilent: true,
    },
  ]);

  const users = JSON.parse(
    readFileSync(join(dataDir, "users.json"), "utf8"),
  ) as Array<Record<string, unknown>>;
  assert.equal(users[0].nextWakeAt, undefined);
  assert.equal(users[0].proactiveCount, 1);
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
