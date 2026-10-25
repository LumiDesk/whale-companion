import assert from "node:assert/strict";
import test from "node:test";

import type { ILogLine } from "../src/lib/types";

const {
  MAX_LOG_LINES,
  appendLogLine,
  formatLogLine,
  logFileName,
  pickOldLogs,
  splitServerTimestamp,
} = await import("../src/lib/logs");

const line = (id: number) => ({
  id,
  ts: new Date(2026, 9, 25, 21, 3, 4).getTime(),
  source: "bot" as const,
  text: `line ${id}`,
});

test("日志按日期命名", () => {
  assert.equal(logFileName(new Date(2026, 9, 25)), "bot-2026-10-25.log");
});

test("提取 Bot 自带的时间戳，避免叠加两层", () => {
  const parsed = splitServerTimestamp("[2026-10-25 21:03:04] 小鲸鱼启动中…");

  assert.ok(parsed);
  assert.equal(parsed?.text, "小鲸鱼启动中…");
  assert.equal(
    new Date(parsed!.ts).getFullYear(),
    2026,
  );
  assert.equal(splitServerTimestamp("at async startQQ"), null);
});

test("日志行带时间和来源", () => {
  assert.equal(
    formatLogLine(line(1)),
    "[21:03:04] [bot] line 1",
  );
});

test("超过上限时只留最近 N 行", () => {
  let lines: ILogLine[] = [];
  for (let i = 0; i < MAX_LOG_LINES + 5; i += 1) {
    lines = appendLogLine(lines, line(i));
  }

  assert.equal(lines.length, MAX_LOG_LINES);
  assert.equal(lines[0].id, 5);
  assert.equal(lines[lines.length - 1].id, MAX_LOG_LINES + 4);
});

test("日志轮转只保留最近 7 天", () => {
  const names = [
    "bot-2026-10-18.log",
    "bot-2026-10-19.log",
    "bot-2026-10-20.log",
    "bot-2026-10-21.log",
    "bot-2026-10-22.log",
    "bot-2026-10-23.log",
    "bot-2026-10-24.log",
    "bot-2026-10-25.log",
    "readme.txt",
  ];

  assert.deepEqual(pickOldLogs(names), ["bot-2026-10-18.log"]);
});
