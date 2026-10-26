import { config } from "../config.js";
import { slog, slogDebug, slogWarn } from "../util.js";
import type {
  IContent,
  IMessage,
  IMessages,
  IModelMessage,
  IModelReply,
  IToolCall,
  IToolDefinition,
} from "../types/message.js";

interface IChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: unknown;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** 把 OpenAI 兼容接口的 content（字符串或分段数组）拼成纯文本 */
const contentToText = (content: unknown): string => {
  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("")
      .trim();
  }

  return "";
};

const isDeepSeekEndpoint = (llm: {
  model: string;
  baseUrl: string;
}): boolean => {
  if (llm.model.toLowerCase().startsWith("deepseek-")) return true;

  try {
    return new URL(llm.baseUrl).hostname.toLowerCase().endsWith("deepseek.com");
  } catch {
    return false;
  }
};

/**
 * 按 DeepSeek 官方文档拼请求体：
 * - thinking: {type: enabled/disabled}，默认开启；
 * - reasoning_effort: low/high/max，默认 high；
 * - 思考模式下 temperature 不生效，所以只在关闭思考时发送；
 * - 非 DeepSeek 接口只发 reasoning_effort，避免 thinking 对象导致 400。
 */
export const buildModelBody = (
  messages: readonly IModelMessage[],
  llm: typeof config.llm = config.llm,
  tools: readonly IToolDefinition[] = [],
): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model: llm.model,
    messages,
    stream: false,
  };

  if (llm.maxTokens > 0) {
    body.max_tokens = llm.maxTokens;
  }

  if (tools.length > 0) {
    body.tools = tools;
  }

  if (llm.thinkingEffort === "off") {
    if (llm.temperature !== null) {
      body.temperature = llm.temperature;
    }
    if (isDeepSeekEndpoint(llm)) {
      body.thinking = { type: "disabled" };
    }
  } else {
    body.reasoning_effort = llm.thinkingEffort;
    if (isDeepSeekEndpoint(llm)) {
      body.thinking = { type: "enabled" };
    }
  }

  return { ...body, ...llm.extraBody };
};

const normalizeToolCalls = (value: unknown): IToolCall[] => {
  if (!Array.isArray(value)) return [];

  const calls: IToolCall[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

    const item = raw as Record<string, unknown>;
    const fn =
      item.function && typeof item.function === "object"
        ? (item.function as Record<string, unknown>)
        : undefined;

    const id = typeof item.id === "string" ? item.id : "";
    const name = typeof fn?.name === "string" ? fn.name : "";
    const args =
      typeof fn?.arguments === "string"
        ? fn.arguments
        : JSON.stringify(fn?.arguments ?? {});

    if (!id || !name) continue;

    calls.push({
      id,
      type: "function",
      function: { name, arguments: args },
    });
  }

  return calls;
};

const toModelMessages = (messages: IMessages): IModelMessage[] =>
  messages.map((message): IModelMessage => {
    if (message.role === "system") {
      return {
        role: "system",
        content: contentToText(message.content),
      };
    }

    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: contentToText(message.content),
      };
    }

    return { role: "user", content: message.content };
  });

/** 带"能不能重试"的错误，避免把 401 这种重试也没用的请求再打一遍 */
class LlmError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "LlmError";
    this.retryable = retryable;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const requestOnce = async (
  messages: readonly IModelMessage[],
  tools: readonly IToolDefinition[],
): Promise<IModelReply> => {
  let res: Response;

  try {
    res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildModelBody(messages, config.llm, tools)),
      signal: AbortSignal.timeout(config.llm.timeoutMs),
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new LlmError(
      `模型请求失败（${Math.round(config.llm.timeoutMs / 1000)}s 超时或网络错误）：${reason}`,
      true,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LlmError(
      `模型调用失败 ${res.status}: ${body.slice(0, 300)}`,
      res.status === 429 || res.status >= 500,
    );
  }

  let data: IChatResponse;
  try {
    data = (await res.json()) as IChatResponse;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new LlmError(`模型返回的不是合法 JSON：${reason}`, true);
  }

  const message = data.choices?.[0]?.message;
  const content = contentToText(message?.content);
  const toolCalls = normalizeToolCalls(message?.tool_calls);
  const reasoning =
    typeof message?.reasoning_content === "string"
      ? message.reasoning_content
      : undefined;

  if (!content && toolCalls.length === 0) {
    throw new LlmError("模型返回了空内容", true);
  }

  const finish = data.choices?.[0]?.finish_reason;
  if (finish === "length") {
    slogWarn(
      "模型输出被截断（finish_reason=length），可以调大 DEEPSEEK_MAX_TOKENS",
    );
  }

  if (data.usage) {
    slogDebug("模型用量", data.usage);
  }

  if (reasoning) {
    slogDebug(`思考链长度：${reasoning.length} 字`);
  }

  return {
    content: content || null,
    reasoningContent: reasoning,
    toolCalls,
    finishReason: finish,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };
};

const requestWithRetry = async (
  messages: readonly IModelMessage[],
  tools: readonly IToolDefinition[],
): Promise<IModelReply> => {
  const retries = Math.max(0, Math.floor(config.llm.retries));
  let last: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestOnce(messages, tools);
    } catch (e) {
      last = e;

      const retryable = e instanceof LlmError ? e.retryable : true;
      if (!retryable || attempt >= retries) break;

      slog(`模型请求失败，${attempt + 1}/${retries} 次重试`, e);
      await sleep(600 * (attempt + 1));
    }
  }

  throw last instanceof Error ? last : new Error(String(last));
};

/**
 * 调一次模型，返回纯文本。
 * 网络错误、超时、429、5xx 会自动重试；4xx 直接抛，让调用方兜底。
 */
export const askModel = async (messages: IMessages): Promise<string> => {
  const reply = await requestWithRetry(toModelMessages(messages), []);

  if (reply.toolCalls.length > 0) {
    throw new Error("模型返回了工具调用，但当前请求没有提供工具");
  }

  if (!reply.content) {
    throw new Error("模型返回了空内容");
  }

  return reply.content;
};

/**
 * Agent 回合用：带 tools 的调用，返回完整 assistant message。
 * thinking 模式下调用方必须把 reasoningContent 带回去。
 */
export const askModelWithTools = async (
  messages: readonly IModelMessage[],
  tools: readonly IToolDefinition[],
): Promise<IModelReply> => requestWithRetry(messages, tools);

export type { IContent, IMessage };
