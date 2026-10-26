import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_PERSONA_ID,
  activePersonaJson,
  isSafePersonaId,
  normalizePersonaText,
  parseActivePersonaId,
  personaDescriptionFromText,
  personaNameFromText,
  personaTemplate,
  summarizePersona,
  uniquePersonaId,
} = await import("../src/lib/personas");

test("人格 ID 校验拒绝路径与保留名", () => {
  assert.equal(isSafePersonaId("deepseek-whale"), true);
  assert.equal(isSafePersonaId("自定义人格"), true);
  assert.equal(isSafePersonaId("../x"), false);
  assert.equal(isSafePersonaId("a/b"), false);
  assert.equal(isSafePersonaId("CON"), false);
});

test("重名时追加序号，中文保留", () => {
  assert.equal(uniquePersonaId("傲娇助手", new Set()), "傲娇助手");
  assert.equal(
    uniquePersonaId("傲娇助手", new Set(["傲娇助手"])),
    "傲娇助手-2",
  );
  assert.equal(uniquePersonaId("  ", new Set()), "custom");
});

test("从 Markdown 提取标题与描述", () => {
  const text = "# 角色卡：小鲸鱼\n\n## 一、你是谁\n\n一只蓝色的小鲸鱼。\n";
  assert.equal(personaNameFromText(text, "fallback"), "小鲸鱼");
  assert.equal(personaDescriptionFromText(text), "一只蓝色的小鲸鱼。");
});

test("active.json 解析失败时回退默认", () => {
  assert.equal(parseActivePersonaId(null), DEFAULT_PERSONA_ID);
  assert.equal(parseActivePersonaId("{"), DEFAULT_PERSONA_ID);
  assert.equal(
    parseActivePersonaId(JSON.stringify({ id: "custom" })),
    "custom",
  );
  assert.equal(parseActivePersonaId(activePersonaJson("custom")), "custom");
});

test("人格文本会去 BOM 和控制字符", () => {
  assert.equal(
    normalizePersonaText("\uFEFF# 标题\r\n内容\u0000"),
    "# 标题\n内容",
  );
});

test("模板与摘要包含必要字段", () => {
  const text = normalizePersonaText(personaTemplate("测试人格"));
  const summary = summarizePersona(
    { id: "test", name: "test", text },
    "user",
    "C:\\personas\\test.md",
  );

  assert.equal(summary.name, "测试人格");
  assert.equal(summary.source, "user");
  assert.ok(summary.chars > 0);
  assert.ok(summary.description.length > 0);
});
