import assert from "node:assert/strict";
import test from "node:test";

const { formatDateTime, formatDuration } = await import("../src/lib/format");

test("运行时长按小时/分钟/秒显示", () => {
  assert.equal(formatDuration(5_000), "5 秒");
  assert.equal(formatDuration(65_000), "1 分 5 秒");
  assert.equal(formatDuration(3_600_000 * 2 + 60_000 * 3), "2 小时 3 分");
  assert.equal(formatDuration(-1), "0 秒");
});

test("时间戳为空显示破折号", () => {
  assert.equal(formatDateTime(null), "—");
  assert.match(formatDateTime(new Date(2026, 9, 25, 21, 3, 4).getTime()), /2026-10-25 21:03:04/);
});
