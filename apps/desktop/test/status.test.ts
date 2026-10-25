import assert from "node:assert/strict";
import test from "node:test";

const { LineBuffer, parseStatusLine } = await import("../src/lib/status");

test("解析合法状态行", () => {
  const event = parseStatusLine(
    '@@WHALE {"v":1,"type":"qq","state":"online","ts":123}',
  );

  assert.equal(event?.type, "qq");
  assert.equal(event?.state, "online");
  assert.equal(event?.ts, 123);
});

test("普通日志不会被当成状态", () => {
  assert.equal(parseStatusLine("[12:00:00] 普通日志"), null);
});

test("坏 JSON / 缺字段返回 null", () => {
  assert.equal(parseStatusLine("@@WHALE {bad"), null);
  assert.equal(parseStatusLine('@@WHALE {"type":"qq"}'), null);
  assert.equal(parseStatusLine('@@WHALE {"v":1}'), null);
});

test("LineBuffer：跨 chunk 的半行会拼起来", () => {
  const buffer = new LineBuffer();

  assert.deepEqual(buffer.push("第一"), []);
  assert.deepEqual(buffer.push("行\r\n第二行\n第三"), ["第一行", "第二行"]);
  assert.deepEqual(buffer.push("行\n"), ["第三行"]);
  assert.deepEqual(buffer.flush(), []);
});

test("LineBuffer：退出时残留的半行也要吐出来", () => {
  const buffer = new LineBuffer();
  buffer.push("没有换行");

  assert.deepEqual(buffer.flush(), ["没有换行"]);
  assert.deepEqual(buffer.flush(), []);
});
