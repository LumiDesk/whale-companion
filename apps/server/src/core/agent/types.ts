import type { AgentStyle, IAgentSettings } from "../../settings.js";
import type {
  IMessage,
  IModelMessage,
  IModelReply,
  IToolDefinition,
} from "../../types/message.js";
import type { IImageInput } from "../../types/message.js";
import type { ISticker } from "../../store/stickers.js";

export type { AgentStyle, IAgentSettings, IModelReply, IToolDefinition };

export type AgentTurnMode = "reactive" | "proactive";

export interface IIncomingMessage {
  seq: number;
  userId: string;
  msgId: string;
  text: string;
  images: IImageInput[];
  at: number;
}

export interface IWaitOptions {
  timeoutMs: number;
  quietMs: number;
}

export interface IWaitResult {
  messages: IIncomingMessage[];
  quiet: boolean;
  timeout: boolean;
}

export interface ISendOutcome {
  sent: number;
  failed: number;
  remaining: number;
}

export interface ITurnBudget {
  step: number;
  maxSteps: number;
  sent: number;
  maxMessages: number;
  /** 本轮已发几张表情包 */
  stickers: number;
  maxStickers: number;
  waitUsed: boolean;
  deadlineAt: number;
}

export type ToolResultKind =
  | "sent"
  | "waited"
  | "silent"
  | "remembered"
  | "wake"
  | "searched"
  | "listed"
  | "error";

export interface IToolExecutionResult {
  kind: ToolResultKind;
  /** kind=sent 时：本轮新增发送条数与文本 */
  sent?: number;
  texts?: string[];
  /** kind=waited 时：等待期间的新消息（含图片） */
  messages?: IIncomingMessage[];
  /** 给模型看的 JSON；不含内部字段 */
  payload: Record<string, unknown>;
}

export type MemoryKind = "fact" | "topic" | "thought";

export interface IRememberInput {
  kind: MemoryKind;
  text: string;
  pendingQuestion?: string;
  expiresInMinutes?: number;
}

export interface IRememberOutput {
  kind: MemoryKind;
  total: number;
  expiresAt?: number;
}

export interface IWakeInput {
  afterMinutes: number;
  intent: string;
  allowSilent: boolean;
}

export interface IWakeOutput {
  wakeAt: number;
}

export interface IStickerPickOptions {
  /** id（完整或 6 位以上前缀）或标签/备注关键词 */
  ref?: string;
  /** 没命中时要不要随机兜底 */
  allowRandom?: boolean;
  /** 本轮已经发过的 id，挑图时排除 */
  excludeIds?: readonly string[];
}

export interface IStickerPickResult {
  sticker: ISticker;
  /** true = 按 id/语义命中；false = 随机兜底 */
  matched: boolean;
  score: number;
}

export interface IAgentToolContextBase {
  userId: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sendText: (text: string) => Promise<ISendOutcome>;
  sendImage: (bytes: Uint8Array) => Promise<ISendOutcome>;
  /** 当前 QQ msg_id 还能回几条 */
  remaining: () => number;
  wait: (opts: IWaitOptions) => Promise<IWaitResult>;
  pickSticker: (options: IStickerPickOptions) => IStickerPickResult | undefined;
  listStickers: (query?: string, limit?: number) => ISticker[];
  readSticker: (sticker: ISticker) => Buffer;
  markStickerUsed: (id: string, context?: string) => void;
  markStickerUnsendable?: (id: string) => void;
  remember: (input: IRememberInput) => IRememberOutput;
  setNextWake: (input: IWakeInput) => IWakeOutput;
  recordReply: () => void;
  recordSilence: (reason: string) => void;
  /** 本轮最新一条用户文本（已去掉表情/图片标记），用于沉默守卫 */
  latestUserText: string;
  silentStreak: number;
  config: IAgentSettings;
  style: AgentStyle;
}

export interface IAgentToolContext extends IAgentToolContextBase {
  budget: ITurnBudget;
  /** 本次模型响应里的 tool call 数量；stay_silent 必须是唯一一个 */
  toolCallCount: number;
}

export type ITurnTranscriptEntry =
  | { role: "user"; content: string; images: number }
  | { role: "assistant"; content: string };

export interface IPersistTurnInput {
  userId: string;
  transcript: ITurnTranscriptEntry[];
  silent: boolean;
  mode: AgentTurnMode;
  at: number;
}

export interface ITurnResult {
  sent: number;
  silent: boolean;
  mode: AgentTurnMode;
}

export interface IAgentDeps {
  history: IMessage[];
  config: IAgentSettings;
  style: AgentStyle;
  now: () => number;
  askModel: (
    messages: IModelMessage[],
    tools: readonly IToolDefinition[],
  ) => Promise<IModelReply>;
  persistTurn: (input: IPersistTurnInput) => Promise<void>;
  toolContext: IAgentToolContextBase;
  /** proactive 回合的意图与“没话说可以沉默”提示 */
  proactiveIntent?: string;
  proactiveAfterMinutes?: number;
  proactiveAllowSilent?: boolean;
}
