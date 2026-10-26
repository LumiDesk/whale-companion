import { config } from "../../config.js";
import { selectImagesForModel, buildUserContent } from "../chat.js";
import { slog } from "../../util.js";
import { TOOL_SCHEMAS } from "./schemas.js";
import { executeTool } from "./tools.js";
import { buildAgentSystem } from "./prompt.js";
import type {
  AgentTurnMode,
  IAgentDeps,
  IAgentToolContext,
  IIncomingMessage,
  IModelReply,
  ITurnBudget,
  ITurnResult,
  ITurnTranscriptEntry,
} from "./types.js";
import type {
  IAssistantWireMessage,
  IImagePart,
  IModelMessage,
  IToolCall,
} from "../../types/message.js";

const FALLBACK_TEXT = "嗯？";

const historyMessages = (deps: IAgentDeps): IModelMessage[] =>
  deps.history.map((message) => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content:
          typeof message.content === "string" ? message.content : "",
      };
    }

    return { role: "user", content: message.content };
  });

const buildBatchUserContent = (batch: IIncomingMessage[]) => {
  const text = batch
    .map((message) => message.text)
    .filter(Boolean)
    .join("\n");

  const images = batch.flatMap((message) => message.images);
  const selected = config.llm.vision
    ? selectImagesForModel(
        images,
        config.llm.maxImages,
        config.llm.maxImageBytes,
      )
    : [];

  if (selected.length === 0) {
    if (text) return text;
    return images.length > 0 ? `[图片x${images.length}]` : "";
  }

  const content = buildUserContent(text, selected);
  if (selected.length < images.length) {
    const hint = `[图片x${selected.length}/${images.length}]`;
    return typeof content === "string" ? `${content}\n${hint}` : content;
  }

  return content;
};

const buildImageOnlyContent = (
  messages: IIncomingMessage[],
): IImagePart[] => {
  const images = messages.flatMap((message) => message.images);
  const selected = config.llm.vision
    ? selectImagesForModel(
        images,
        config.llm.maxImages,
        config.llm.maxImageBytes,
      )
    : [];

  return selected.map((image) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${image.mime};base64,${Buffer.from(image.data).toString("base64")}`,
    },
  }));
};

const toAssistantWire = (reply: IModelReply): IAssistantWireMessage => ({
  role: "assistant",
  content: reply.content,
  ...(reply.reasoningContent
    ? { reasoning_content: reply.reasoningContent }
    : {}),
  ...(reply.toolCalls.length > 0 ? { tool_calls: reply.toolCalls } : {}),
});

const toolError = (call: IToolCall, message: string): IModelMessage => ({
  role: "tool",
  tool_call_id: call.id,
  content: JSON.stringify({ ok: false, error: message }),
});

const transcriptOf = (batch: IIncomingMessage[]): ITurnTranscriptEntry[] => {
  const text = batch
    .map((message) => message.text)
    .filter(Boolean)
    .join("\n");
  const images = batch.reduce(
    (sum, message) => sum + message.images.length,
    0,
  );

  return [
    {
      role: "user",
      content: text || (images > 0 ? "[图片]" : ""),
      images,
    },
  ];
};

export const runAgentTurn = async (
  userId: string,
  batch: IIncomingMessage[],
  mode: AgentTurnMode,
  deps: IAgentDeps,
): Promise<ITurnResult> => {
  const budget: ITurnBudget = {
    step: 0,
    maxSteps: deps.config.maxSteps,
    sent: 0,
    maxMessages: deps.config.maxMessages,
    waitUsed: false,
    deadlineAt: deps.now() + deps.config.turnTimeoutMs,
  };

  const system = buildAgentSystem(userId, batch, budget, deps, mode);
  const userContent =
    batch.length > 0
      ? buildBatchUserContent(batch)
      : mode === "proactive"
        ? "（现在是你主动找他）"
        : "";
  const messages: IModelMessage[] = [
    { role: "system", content: system },
    ...historyMessages(deps),
    { role: "user", content: userContent },
  ];

  const transcript = transcriptOf(batch);
  let finalText = "";
  let silent = false;

  while (budget.step < budget.maxSteps && deps.now() < budget.deadlineAt) {
    budget.step += 1;

    const reply = await deps.askModel(messages, TOOL_SCHEMAS);
    messages.push(toAssistantWire(reply));

    if (reply.toolCalls.length === 0) {
      finalText = reply.content ?? "";
      break;
    }

    for (const call of reply.toolCalls) {
      if (deps.now() >= budget.deadlineAt) {
        messages.push(toolError(call, "回合超时"));
        break;
      }

      const toolContext: IAgentToolContext = {
        ...deps.toolContext,
        budget,
        toolCallCount: reply.toolCalls.length,
      };

      const result = await executeTool(call, toolContext);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result.payload),
      });

      if (result.kind === "silent") {
        silent = true;
        break;
      }

      if (result.kind === "sent") {
        budget.sent += result.sent ?? 0;
        for (const text of result.texts ?? []) {
          transcript.push({ role: "assistant", content: text });
        }
      }

      if (result.kind === "waited") {
        const waited = result.messages ?? [];
        for (const message of waited) {
          transcript.push({
            role: "user",
            content: message.text || (message.images.length > 0 ? "[图片]" : ""),
            images: message.images.length,
          });
        }

        const last = waited[waited.length - 1];
        if (last?.text) deps.toolContext.latestUserText = last.text;

        const imageContent = buildImageOnlyContent(waited);
        if (imageContent.length > 0) {
          messages.push({ role: "user", content: imageContent });
        }
      }

      if (budget.sent >= budget.maxMessages) break;
    }

    if (silent || budget.sent >= budget.maxMessages) break;
  }

  if (!silent && budget.sent === 0 && mode === "reactive") {
    const fallback = finalText.trim() || FALLBACK_TEXT;

    try {
      await deps.toolContext.sendText(fallback);
      deps.toolContext.recordReply();
      transcript.push({ role: "assistant", content: fallback });
    } catch (error) {
      slog("Agent 兜底发送失败", error);
    }
  }

  if (!silent && budget.sent === 0 && mode === "proactive") {
    silent = true;
  }

  await deps.persistTurn({
    userId,
    transcript,
    silent,
    mode,
    at: deps.now(),
  });

  return { sent: budget.sent, silent, mode };
};
