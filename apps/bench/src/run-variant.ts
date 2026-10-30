import { writeFileSync } from "node:fs";

import { config } from "../../server/src/config.js";
import { runAgentTurn } from "../../server/src/core/agent/loop.js";
import { askModelWithTools } from "../../server/src/core/llm.js";
import type {
  IAgentDeps,
  IAgentToolContextBase,
  IIncomingMessage,
} from "../../server/src/core/agent/types.js";
import type { IMessage } from "../../server/src/types/message.js";
import { SCENARIOS } from "./scenarios.js";
import { findVariant } from "./variants.js";
import type {
  IHistoryMessage,
  IScenarioResult,
  IToolCallRecord,
  ITurnRecord,
  IVariantResult,
} from "./types.js";

const argOf = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const variantId = argOf("variant") ?? "baseline";
const outFile = argOf("out") ?? `out/${variantId}.json`;
const only = argOf("scenarios")
  ?.split(/[,\s]+/)
  .map((item) => item.trim())
  .filter(Boolean);

const variant = findVariant(variantId);
if (!variant) {
  console.error(`未知变体：${variantId}`);
  process.exit(1);
}

const scenarios = SCENARIOS.filter(
  (scenario) => !only || only.includes(scenario.id),
);

if (scenarios.length === 0) {
  console.error("没有匹配的场景");
  process.exit(1);
}

interface ITurnState {
  sends: string[];
  toolCalls: IToolCallRecord[];
  memories: string[];
  silences: string[];
  latestUserText: string;
  modelCalls: number;
}

const toHistory = (messages: IHistoryMessage[] | undefined): IMessage[] =>
  (messages ?? []).map((message) => ({
    role: message.role,
    content: message.content,
  }));

const newState = (latestUserText: string): ITurnState => ({
  sends: [],
  toolCalls: [],
  memories: [],
  silences: [],
  latestUserText,
  modelCalls: 0,
});

const buildContext = (state: ITurnState): IAgentToolContextBase => ({
  userId: "bench-user",
  now: () => Date.now(),
  sleep: async () => {},
  sendText: async (text) => {
    state.sends.push(text);
    return {
      sent: 1,
      failed: 0,
      remaining: Math.max(0, config.agent.maxMessages - state.sends.length),
    };
  },
  sendImage: async () => {
    state.sends.push("[表情包]");
    return {
      sent: 1,
      failed: 0,
      remaining: Math.max(0, config.agent.maxMessages - state.sends.length),
    };
  },
  remaining: () => Math.max(0, config.agent.maxMessages - state.sends.length),
  wait: async () => ({ messages: [], quiet: false, timeout: true }),
  pickSticker: () => undefined,
  readSticker: () => Buffer.alloc(0),
  remember: (input) => {
    state.memories.push(input.text);
    return { kind: input.kind, total: state.memories.length };
  },
  setNextWake: (input) => ({
    wakeAt: Date.now() + input.afterMinutes * 60_000,
  }),
  recordReply: () => {},
  recordSilence: (reason) => {
    state.silences.push(reason);
  },
  latestUserText: state.latestUserText,
  silentStreak: 0,
  config: config.agent,
  style: config.agent.style,
});

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const run = async (): Promise<void> => {
  const results: IScenarioResult[] = [];

  for (const scenario of scenarios) {
    const history = toHistory(scenario.history);
    const turns: ITurnRecord[] = [];

    console.log(
      `[${variantId}] ${scenario.title}：${scenario.turns.length} 轮`,
    );

    for (let index = 0; index < scenario.turns.length; index += 1) {
      const user = scenario.turns[index];
      const state = newState(user);
      const context = buildContext(state);

      const askModel: IAgentDeps["askModel"] = async (messages, tools) => {
        state.modelCalls += 1;
        const reply = await askModelWithTools(messages, tools);
        for (const call of reply.toolCalls) {
          state.toolCalls.push({
            name: call.function.name,
            args: call.function.arguments.slice(0, 300),
          });
        }
        return reply;
      };

      const deps: IAgentDeps = {
        history,
        config: config.agent,
        style: config.agent.style,
        now: () => Date.now(),
        askModel,
        persistTurn: async ({ transcript }) => {
          for (const entry of transcript) {
            if (entry.role === "assistant") {
              history.push({ role: "assistant", content: entry.content });
            } else {
              history.push({
                role: "user",
                content:
                  entry.images > 0
                    ? `${entry.content} [图片x${entry.images}]`
                    : entry.content,
              });
            }
          }
        },
        toolContext: context,
      };

      const incoming: IIncomingMessage = {
        seq: index + 1,
        userId: "bench-user",
        msgId: `bench-${scenario.id}-${index + 1}`,
        text: user,
        images: [],
        at: Date.now(),
      };

      const startedAt = Date.now();
      let silent = false;
      let error: string | undefined;

      try {
        const result = await runAgentTurn(
          "bench-user",
          [incoming],
          "reactive",
          deps,
        );
        silent = result.silent;
      } catch (e) {
        error = errorText(e);
        console.error(`[${variantId}] 回合失败：${error}`);
      }

      turns.push({
        user,
        assistant: [...state.sends],
        toolCalls: [...state.toolCalls],
        latencyMs: Date.now() - startedAt,
        modelCalls: state.modelCalls,
        silent,
        ...(error ? { error } : {}),
      });

      const tools = state.toolCalls.map((call) => call.name).join(",");
      console.log(
        `  ${index + 1}/${scenario.turns.length} ` +
          `${Date.now() - startedAt}ms / ${state.modelCalls} 次模型` +
          `${tools ? ` / 工具 ${tools}` : ""}` +
          `${state.sends.length === 0 ? " / 沉默" : ""}`,
      );
    }

    results.push({
      id: scenario.id,
      title: scenario.title,
      note: scenario.note,
      turns,
    });
  }

  const payload: IVariantResult = {
    variant: variant.id,
    label: variant.label,
    model: config.llm.model,
    sampling: variant.sampling,
    startedAt: new Date().toISOString(),
    scenarios: results,
  };

  writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[${variantId}] 完成 -> ${outFile}`);
};

await run();
