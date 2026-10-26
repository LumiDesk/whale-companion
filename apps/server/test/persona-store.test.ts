import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";
process.env.OWNER_NAME = "老板";

const dataDir = mkdtempSync(join(tmpdir(), "whale-persona-"));
const userPersonaDir = join(dataDir, "personas");
process.env.WHALE_DATA_DIR = dataDir;
process.env.WHALE_USER_PERSONA_DIR = userPersonaDir;
process.env.WHALE_PERSONA_DIR = fileURLToPath(
  new URL("../personas", import.meta.url),
);

const {
  DEFAULT_PERSONA_ID,
  ensurePersonaLayout,
  getActivePersonaCard,
  getActivePersonaId,
  getPersonaText,
  isSafePersonaId,
  listPersonaSummaries,
  readPersonaCard,
  renderPersonaText,
} = await import("../src/core/persona-store.js");

test("内置人格卡可读，默认是 deepseek-whale", () => {
  const cards = listPersonaSummaries();
  assert.ok(cards.some((card) => card.id === DEFAULT_PERSONA_ID));
  assert.ok(cards.some((card) => card.id === "tsundere-assistant"));
  assert.equal(getActivePersonaId(), DEFAULT_PERSONA_ID);

  const card = getActivePersonaCard();
  assert.equal(card.id, DEFAULT_PERSONA_ID);
  assert.ok(card.text.includes("DeepSeek 小鲸鱼"));
  assert.ok(card.name.includes("DeepSeek 小鲸鱼"));
});

test("人格 ID 会拒绝路径穿越与 Windows 保留名", () => {
  assert.equal(isSafePersonaId("deepseek-whale"), true);
  assert.equal(isSafePersonaId("自定义_1"), true);
  assert.equal(isSafePersonaId("../evil"), false);
  assert.equal(isSafePersonaId("a/b"), false);
  assert.equal(isSafePersonaId("CON"), false);
  assert.equal(isSafePersonaId(""), false);
});

test("active.json 缺失时 ensurePersonaLayout 会补齐", () => {
  ensurePersonaLayout();

  const active = JSON.parse(
    readFileSync(join(userPersonaDir, "active.json"), "utf8"),
  ) as { id: string };
  assert.equal(active.id, DEFAULT_PERSONA_ID);
});

test("用户人格卡覆盖内置卡，active 指向用户卡", () => {
  ensurePersonaLayout();
  writeFileSync(
    join(userPersonaDir, "custom.md"),
    "# 自定义\n\n这是自定义人格。\n",
    "utf8",
  );
  writeFileSync(
    join(userPersonaDir, "active.json"),
    JSON.stringify({ id: "custom" }),
    "utf8",
  );

  const card = getActivePersonaCard();
  assert.equal(card.id, "custom");
  assert.equal(card.source, "user");
  assert.ok(getPersonaText().includes("这是自定义人格"));
});

test("人设里的「主人」会替换成 OWNER_NAME", () => {
  const text = renderPersonaText("主人，过来一下。{{ownerName}}");
  assert.equal(text, "老板，过来一下。老板");
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
