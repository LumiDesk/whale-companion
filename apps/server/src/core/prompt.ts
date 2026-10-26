/**
 * 旧路径的 system 组装：无工具、直接输出文本。
 * Agent 回合使用 core/agent/prompt.ts 的 buildAgentSystem。
 */
export { buildLegacySystem as buildSystem } from "./agent/prompt.js";
