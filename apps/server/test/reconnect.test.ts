import assert from "node:assert/strict";
import test from "node:test";

import {
  canResumeSession,
  classifyClose,
  describeCloseCode,
  HEALTHY_SESSION_MS,
  initialReconnectState,
  planReconnect,
  RAPID_KICK_BACKOFF_MS,
  RAPID_KICK_LIMIT,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  reconnectDelay,
  RESUME_TTL_MS,
} from "../src/channels/qq/reconnect.js";

test("会话过期 / session / seq / 频率类关闭码都要重连", () => {
  for (const code of [4006, 4007, 4008, 4009, 1000, 1005, 1006, -1]) {
    assert.equal(classifyClose(code), "reconnect", `关闭码 ${code} 应该重连`);
  }
});

test("配置与权限类关闭码不重连", () => {
  for (const code of [4010, 4012, 4013, 4014, 4914, 4915]) {
    assert.equal(classifyClose(code), "fatal", `关闭码 ${code} 不该重试`);
  }
});

test("陌生的关闭码按可恢复处理，不轻易放弃", () => {
  assert.equal(classifyClose(4999), "reconnect");
  assert.equal(classifyClose(4900), "reconnect");
});

test("关闭码有中文说明，没收录的显示原始数字", () => {
  assert.equal(describeCloseCode(4009), "连接过期");
  assert.equal(describeCloseCode(-1), "连接异常");
  assert.equal(describeCloseCode(4321), "关闭码 4321");
});

test("退避从 3 秒开始翻倍，封顶 60 秒", () => {
  assert.equal(reconnectDelay(1), 3000);
  assert.equal(reconnectDelay(2), 6000);
  assert.equal(reconnectDelay(3), 12000);
  assert.equal(reconnectDelay(6), RECONNECT_MAX_MS);
  assert.equal(reconnectDelay(99), RECONNECT_MAX_MS);
});

test("稳定在线一小时后断开：退避归零，按正常节奏重连", () => {
  const state = { attempt: 5, rapidKicks: 2 };
  const plan = planReconnect(state, 4009, HEALTHY_SESSION_MS);

  assert.equal(plan.decision, "reconnect");
  assert.equal(plan.delayMs, RECONNECT_BASE_MS);
  assert.equal(plan.state.attempt, 1);
  assert.equal(plan.state.rapidKicks, 0);
  assert.equal(plan.reason, "连接过期");
});

test("刚连上就被断开：连续计数，够了就放慢到 5 分钟", () => {
  let state = initialReconnectState();
  const delays: number[] = [];

  for (let i = 0; i < RAPID_KICK_LIMIT; i += 1) {
    const plan = planReconnect(state, 4009, 1200);
    state = plan.state;
    delays.push(plan.delayMs);
  }

  assert.deepEqual(delays.slice(0, 2), [3000, 6000]);
  assert.equal(state.rapidKicks, RAPID_KICK_LIMIT);
  assert.ok(delays[2] >= RAPID_KICK_BACKOFF_MS);
});

test("连上但撑过 10 秒就不算被顶号，快速断开计数清零", () => {
  const plan = planReconnect({ attempt: 2, rapidKicks: 2 }, 1006, 30_000);

  assert.equal(plan.state.rapidKicks, 0);
  assert.equal(plan.state.attempt, 3);
  assert.equal(plan.delayMs, 12000);
});

test("根本没连上（取 token / 网关失败）只累计重试次数，不算被顶号", () => {
  const plan = planReconnect({ attempt: 1, rapidKicks: 2 }, -1, -1);

  assert.equal(plan.decision, "reconnect");
  assert.equal(plan.state.attempt, 2);
  assert.equal(plan.state.rapidKicks, 0);
  assert.equal(plan.delayMs, 6000);
});

test("致命码返回 fatal、延迟为 0，并重置状态", () => {
  const plan = planReconnect({ attempt: 4, rapidKicks: 3 }, 4014, 50_000);

  assert.equal(plan.decision, "fatal");
  assert.equal(plan.delayMs, 0);
  assert.match(plan.reason, /权限/);
  assert.deepEqual(plan.state, initialReconnectState());
});

test("断线 5 分钟内可以 resume，超时或没有会话就重新 identify", () => {
  const now = 1_800_000_000_000;
  const session = { id: "session-1", seq: 7, at: now - 1_000 };

  assert.equal(canResumeSession(session, now), true);
  assert.equal(
    canResumeSession({ ...session, at: now - RESUME_TTL_MS }, now),
    true,
  );
  assert.equal(
    canResumeSession({ ...session, at: now - RESUME_TTL_MS - 1 }, now),
    false,
  );
  assert.equal(canResumeSession(null, now), false);
  assert.equal(canResumeSession({ id: "", seq: 0, at: now }, now), false);
  assert.equal(canResumeSession({ ...session, at: now + 1_000 }, now), false);
});
