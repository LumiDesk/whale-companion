import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const { writeJsonAtomic } = await import("../src/store/atomic.js");
const { sanitizeHistoryFile } = await import("../src/store/history.js");
const { cleanQQContent } = await import("../src/channels/qq/text.js");

const makeTempDir = (prefix: string): string =>
  mkdtempSync(join(tmpdir(), prefix));

test("原子写会覆盖旧内容，且不残留临时文件", () => {
  const dir = makeTempDir("whale-atomic-");

  try {
    const file = join(dir, "data.json");

    writeJsonAtomic(file, { hello: "世界" });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
      hello: "世界",
    });

    writeJsonAtomic(file, { hello: "again", count: 2 });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
      hello: "again",
      count: 2,
    });

    const leftovers = readdirSync(dir).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("原子写会自动创建不存在的目录", () => {
  const dir = makeTempDir("whale-atomic-dir-");

  try {
    const file = join(dir, "nested", "data.json");
    writeJsonAtomic(file, { ok: true });

    assert.equal(existsSync(file), true);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("历史清理：去掉旧平台标记，备份原文件，重复执行不再改动", () => {
  const dir = makeTempDir("whale-history-");

  try {
    const file = join(dir, "history.json");
    const original = {
      u1: [
        {
          role: "user",
          content:
            '你好\n<faceType=6,faceId="0",ext="eyJ0ZXh0IjoiIn0="> [图片x1]',
        },
        { role: "assistant", content: "哼，才没有等你呢" },
      ],
      u2: [
        { role: "user", content: "干净的消息" },
        { role: "user", content: '在吗<@!123456> ' },
      ],
    };

    writeFileSync(file, JSON.stringify(original, null, 2), "utf8");

    const result = sanitizeHistoryFile(file, cleanQQContent);

    assert.equal(result.changed, 2);
    assert.equal(result.users, 2);
    assert.ok(result.backup);
    assert.equal(existsSync(result.backup), true);

    const cleaned = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(cleaned.u1[0].content, "你好\n[图片x1]");
    assert.equal(cleaned.u1[1].content, "哼，才没有等你呢");
    assert.equal(cleaned.u2[0].content, "干净的消息");
    assert.equal(cleaned.u2[1].content, "在吗");

    // 备份里必须是改动前的原样，方便出问题时回滚
    const backup = readFileSync(result.backup, "utf8");
    assert.ok(backup.includes("<faceType="));
    assert.ok(backup.includes("<@!123456>"));

    const backupsBefore = readdirSync(dir).filter((name) =>
      name.includes(".bak-"),
    ).length;

    const second = sanitizeHistoryFile(file, cleanQQContent);
    assert.equal(second.changed, 0);
    assert.equal(second.backup, null);

    const backupsAfter = readdirSync(dir).filter((name) =>
      name.includes(".bak-"),
    ).length;
    assert.equal(backupsAfter, backupsBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("历史文件损坏时绝不覆盖", () => {
  const dir = makeTempDir("whale-history-broken-");

  try {
    const file = join(dir, "history.json");
    writeFileSync(file, '{"u1": [', "utf8");

    const result = sanitizeHistoryFile(file, cleanQQContent);

    assert.equal(result.changed, 0);
    assert.equal(result.backup, null);
    assert.equal(readFileSync(file, "utf8"), '{"u1": [');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
