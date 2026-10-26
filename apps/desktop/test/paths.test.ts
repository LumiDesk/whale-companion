import assert from "node:assert/strict";
import test from "node:test";

const { buildAppPaths, buildServerPaths, joinPath, normalizePath } =
  await import("../src/lib/paths");

test("拼接 Windows 路径", () => {
  assert.equal(joinPath("C:\\Users\\me", "AppData"), "C:\\Users\\me\\AppData");
  assert.equal(joinPath("C:\\", "a", "b"), "C:\\a\\b");
  assert.equal(joinPath("C:\\a\\", "/b/"), "C:\\a\\b");
});

test("归一化路径会收掉 . 和 ..", () => {
  assert.equal(
    normalizePath("C:\\repo\\apps\\desktop\\..\\server\\dist"),
    "C:\\repo\\apps\\server\\dist",
  );
  assert.equal(
    normalizePath("C:/repo/apps/server/dist"),
    "C:\\repo\\apps\\server\\dist",
  );
  assert.equal(normalizePath("C:\\"), "C:\\");
});

test("应用目录固定在 whale-companion 下", () => {
  const paths = buildAppPaths("C:\\Users\\me\\AppData\\Roaming");

  assert.equal(paths.root, "C:\\Users\\me\\AppData\\Roaming\\whale-companion");
  assert.equal(
    paths.configFile,
    "C:\\Users\\me\\AppData\\Roaming\\whale-companion\\config.json",
  );
  assert.equal(
    paths.personaDir,
    "C:\\Users\\me\\AppData\\Roaming\\whale-companion\\personas",
  );
  assert.equal(
    paths.activePersonaFile,
    "C:\\Users\\me\\AppData\\Roaming\\whale-companion\\personas\\active.json",
  );
});

test("开发态找仓库里的 server", () => {
  const paths = buildServerPaths("C:\\repo\\apps\\desktop", false, "C:\\data");

  assert.equal(paths.serverDir, "C:\\repo\\apps\\server\\dist");
  assert.equal(paths.builtinPersonaDir, "C:\\repo\\apps\\server\\personas");
  assert.equal(paths.promptsDir, "C:\\repo\\apps\\server\\prompts");
  assert.equal(paths.dataDir, "C:\\repo\\apps\\server\\data");
});

test("打包态 server 在 exe 旁边，数据在 AppData", () => {
  const paths = buildServerPaths(
    "C:\\Apps\\WhaleCompanion",
    true,
    "C:\\Users\\me\\AppData\\Roaming\\whale-companion\\data",
  );

  assert.equal(paths.serverDir, "C:\\Apps\\WhaleCompanion\\server");
  assert.equal(
    paths.builtinPersonaDir,
    "C:\\Apps\\WhaleCompanion\\server\\personas",
  );
  assert.equal(paths.promptsDir, "C:\\Apps\\WhaleCompanion\\server\\prompts");
  assert.equal(
    paths.dataDir,
    "C:\\Users\\me\\AppData\\Roaming\\whale-companion\\data",
  );
});
