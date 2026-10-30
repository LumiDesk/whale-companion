import type { ISampling } from "./types.js";

export interface IVariantSpec {
  id: string;
  label: string;
  description: string;
  /** variants/<dir>/ 下的 persona.md / behavior.md 覆盖；不填用仓库当前文件 */
  promptSource?: string;
  sampling: ISampling;
}

const FLASH_DEFAULT: ISampling = {
  thinkingEffort: "low",
  temperature: null,
  extraBody: {},
};

const EXAMPLES_SAMPLING: ISampling = {
  thinkingEffort: "off",
  temperature: 1.2,
  extraBody: {
    presence_penalty: 0.6,
    frequency_penalty: 0.4,
    top_p: 0.9,
  },
};

export const VARIANTS: readonly IVariantSpec[] = [
  {
    id: "baseline",
    label: "现状",
    description:
      "仓库当前的 persona + behavior + thinking=low；只带上新加的联网搜索。",
    sampling: FLASH_DEFAULT,
  },
  {
    id: "examples",
    label: "示例增强",
    description:
      "采样不变；人格卡加反应手册与聪明向示例，行为层加对照示例，放宽 emoji / 语气词限制。",
    promptSource: "examples",
    sampling: FLASH_DEFAULT,
  },
  {
    id: "examples-sampling",
    label: "示例 + 采样",
    description:
      "示例增强 + 关闭思考、temperature 1.2、presence 0.6 / frequency 0.4 / top_p 0.9。",
    promptSource: "examples",
    sampling: EXAMPLES_SAMPLING,
  },
  {
    id: "lean",
    label: "示例 + 采样 + 瘦身",
    description:
      "在上一个变体基础上把行为层压到核心规则（去掉表情包 / 主动 / 自检等），保留示例。",
    promptSource: "lean",
    sampling: EXAMPLES_SAMPLING,
  },
];

export const findVariant = (id: string): IVariantSpec | undefined =>
  VARIANTS.find((variant) => variant.id === id);
