import assert from "node:assert/strict";
import test from "node:test";

const { getValueAt, setValueAt } = await import("../src/lib/settings-form");

test("按路径读取嵌套配置", () => {
  const config = { llm: { model: "deepseek-flash" }, behavior: { tray: 1 } };

  assert.equal(getValueAt(config, "llm.model"), "deepseek-flash");
  assert.equal(getValueAt(config, "llm.missing"), undefined);
  assert.equal(getValueAt(null, "llm.model"), undefined);
});

test("按路径写入时保持不可变", () => {
  const config = {
    llm: { model: "a", nested: { value: 1 } },
    other: "keep",
  };

  const next = setValueAt(config, "llm.model", "b");

  assert.notEqual(next, config);
  assert.notEqual(next.llm, config.llm);
  assert.equal(config.llm.model, "a");
  assert.equal(next.llm.model, "b");
  assert.equal(next.other, "keep");
  assert.deepEqual(next.llm.nested, { value: 1 });
});

test("路径中间缺对象时会自动补上", () => {
  const next = setValueAt({} as { a?: { b?: number } }, "a.b", 1);
  assert.deepEqual(next, { a: { b: 1 } });
});
