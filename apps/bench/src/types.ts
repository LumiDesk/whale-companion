export type HistoryRole = "user" | "assistant";

export interface IHistoryMessage {
  role: HistoryRole;
  content: string;
}

export interface IScenario {
  id: string;
  title: string;
  /** 给评分人看的一句话说明 */
  note: string;
  /** 开局前已经存在的对话（用来测记忆） */
  history?: IHistoryMessage[];
  /** 脚本化用户，每一条是一轮 */
  turns: string[];
}

export interface IToolCallRecord {
  name: string;
  args: string;
}

export interface ITurnRecord {
  user: string;
  assistant: string[];
  toolCalls: IToolCallRecord[];
  /** 本轮墙钟耗时（含搜索） */
  latencyMs: number;
  modelCalls: number;
  silent: boolean;
  error?: string;
}

export interface IScenarioResult {
  id: string;
  title: string;
  note: string;
  turns: ITurnRecord[];
}

export interface ISampling {
  thinkingEffort: string;
  temperature: number | null;
  extraBody: Record<string, unknown>;
}

export interface IVariantResult {
  variant: string;
  label: string;
  model: string;
  sampling: ISampling;
  startedAt: string;
  scenarios: IScenarioResult[];
}

/** 每个场景里，展示用的匿名标签 -> 真实变体 id */
export type LabelMapping = Record<string, string>;

export interface IRun {
  runId: string;
  startedAt: string;
  model: string;
  variants: IVariantResult[];
  /** scenarioId -> { "版本 1": variantId, ... } */
  mapping: Record<string, LabelMapping>;
}
