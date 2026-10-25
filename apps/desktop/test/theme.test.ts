import assert from "node:assert/strict";
import test from "node:test";

const { resolveTheme, systemPrefersDark } = await import("../src/lib/theme");
const { normalizeConfig } = await import("../src/lib/config");

test("跟随系统时，按系统偏好解析", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("固定模式不受系统偏好影响", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("非浏览器环境按浅色系统处理", () => {
  assert.equal(systemPrefersDark(), false);
});

test("旧配置没有 appearance 时默认跟随系统", () => {
  assert.equal(normalizeConfig(null).appearance.theme, "system");
  assert.equal(
    normalizeConfig({ qq: { appId: "1" } }).appearance.theme,
    "system",
  );
});

test("非法主题值回退到跟随系统", () => {
  const parsed = normalizeConfig({ appearance: { theme: "purple" } });
  assert.equal(parsed.appearance.theme, "system");
});

test("合法主题值被保留", () => {
  assert.equal(
    normalizeConfig({ appearance: { theme: "dark" } }).appearance.theme,
    "dark",
  );
  assert.equal(
    normalizeConfig({ appearance: { theme: "light" } }).appearance.theme,
    "light",
  );
});
