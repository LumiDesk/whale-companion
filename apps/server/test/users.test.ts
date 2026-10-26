import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const dataDir = mkdtempSync(join(tmpdir(), "whale-users-"));
process.env.WHALE_DATA_DIR = dataDir;

const {
  flushUsers,
  listUsers,
  markProactive,
  proactiveCountFor,
  touchUser,
} = await import("../src/store/users.js");

test("touchUser 走缓存并节流落盘", () => {
  touchUser("u1", "qq");
  touchUser("u1", "qq");

  assert.equal(listUsers().length, 1);
  assert.ok(listUsers()[0].lastSeen > 0);

  flushUsers();
  const parsed = JSON.parse(
    readFileSync(join(dataDir, "users.json"), "utf8"),
  ) as Array<{ userId: string }>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].userId, "u1");
});

test("每天主动次数：旧记录按 1 次兼容，mark 后递增", () => {
  const now = new Date(2026, 9, 26, 10, 0, 0);

  assert.equal(
    proactiveCountFor(
      {
        userId: "u2",
        channel: "qq",
        lastSeen: 0,
        lastProactiveAt: now.getTime(),
      },
      now,
    ),
    1,
  );

  touchUser("u2", "qq");
  markProactive("u2", "qq", now);
  markProactive("u2", "qq", now);

  const user = listUsers().find((item) => item.userId === "u2");
  assert.equal(proactiveCountFor(user!, now), 2);
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
