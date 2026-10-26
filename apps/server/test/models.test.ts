import assert from "node:assert/strict";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const { parseModelsResponse } = await import("../src/core/models.js");

test("解析模型列表：id、名称、上下文与思考档位", () => {
  const models = parseModelsResponse({
    object: "list",
    data: [
      {
        id: "deepseek-flash",
        object: "model",
        owned_by: "deepseek",
        name: "DeepSeek-V4.1-Flash",
        context_window: 1048576,
        max_output_tokens: 393216,
        input_modalities: ["text", "image"],
        effort: {
          supported_levels: ["low", "high", "max"],
          default_level: "high",
        },
      },
    ],
  });

  assert.equal(models.length, 1);
  assert.equal(models[0].id, "deepseek-flash");
  assert.equal(models[0].name, "DeepSeek-V4.1-Flash");
  assert.equal(models[0].contextWindow, 1048576);
  assert.deepEqual(models[0].effortLevels, ["low", "high", "max"]);
  assert.equal(models[0].defaultEffort, "high");
});

test("字段缺失或结构不对时返回空数组", () => {
  assert.deepEqual(parseModelsResponse(null), []);
  assert.deepEqual(parseModelsResponse({}), []);
  assert.deepEqual(parseModelsResponse({ data: "nope" }), []);
  assert.deepEqual(parseModelsResponse({ data: [{ name: "x" }] }), []);
});

test("忽略没有 id 的条目，保留合法条目", () => {
  const models = parseModelsResponse({
    data: [{ id: "a" }, { name: "missing-id" }, { id: "b" }],
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ["a", "b"],
  );
});
