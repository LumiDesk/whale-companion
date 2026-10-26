import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

import { config } from "../config.js";
import { writeJsonAtomic } from "../store/atomic.js";
import { slog } from "../util.js";

export type PersonaSource = "builtin" | "user";

export interface IPersonaSummary {
  id: string;
  name: string;
  description: string;
  source: PersonaSource;
  path: string;
  chars: number;
}

export interface IPersonaCard extends IPersonaSummary {
  text: string;
}

export interface IActivePersonaFile {
  id: string;
  updatedAt?: number;
}

export const DEFAULT_PERSONA_ID = "deepseek-whale";

const MINIMAL_PERSONA =
  "你叫「小鲸鱼」，是住在他电脑里的一只蓝色小鲸鱼。说话口语、简短、有点傲娇，但很在意他。";

const RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/** 人格卡 ID：中文、字母、数字、下划线、连字符；拒绝路径穿越与 Windows 保留名 */
export const isSafePersonaId = (id: string): boolean => {
  if (!/^[\p{L}\p{N}_-]{1,48}$/u.test(id)) return false;
  return !RESERVED_NAMES.has(id.toLowerCase());
};

const stripBom = (text: string): string =>
  text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

const headingOf = (text: string, fallback: string): string => {
  const match = /^#\s+(.+)$/m.exec(text);
  if (!match) return fallback;

  return match[1]
    .replace(/^角色卡[：:]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
};

const descriptionOf = (text: string): string => {
  const lines = text.split(/\r?\n/);
  let seenHeading = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      seenHeading = true;
      continue;
    }
    if (!seenHeading) continue;
    if (
      line.startsWith("- ") ||
      line.startsWith("* ") ||
      line.startsWith("> ") ||
      /^\d+[.、]\s/.test(line)
    ) {
      continue;
    }

    const plain = line.replace(/[*_`]/g, "").trim();
    return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
  }

  return "";
};

const readText = (file: string): string | null => {
  try {
    if (!existsSync(file)) return null;
    const text = stripBom(readFileSync(file, "utf8"));
    return text.trim() ? text : null;
  } catch (error) {
    slog(`读取人格卡失败：${file}`, error);
    return null;
  }
};

const cardFromFile = (
  file: string,
  id: string,
  source: PersonaSource,
): IPersonaCard | null => {
  const text = readText(file);
  if (text === null) return null;

  return {
    id,
    name: headingOf(text, id),
    description: descriptionOf(text),
    source,
    path: file,
    chars: text.length,
    text,
  };
};

const listCardsIn = (dir: string, source: PersonaSource): IPersonaCard[] => {
  let names: string[];

  try {
    if (!existsSync(dir)) return [];
    names = readdirSync(dir);
  } catch (error) {
    slog(`读取人格卡目录失败：${dir}`, error);
    return [];
  }

  const cards: IPersonaCard[] = [];

  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;

    const id = name.slice(0, -3);
    if (!isSafePersonaId(id)) continue;

    const file = join(dir, name);
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }

    const card = cardFromFile(file, id, source);
    if (card) cards.push(card);
  }

  return cards.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
};

/** 内置卡在前；用户卡同 ID 会覆盖内置卡（正常流程应避免重名） */
export const listPersonas = (): IPersonaCard[] => {
  const map = new Map<string, IPersonaCard>();

  for (const card of listCardsIn(config.paths.personaDir, "builtin")) {
    map.set(card.id, card);
  }
  for (const card of listCardsIn(config.paths.userPersonaDir, "user")) {
    map.set(card.id, card);
  }

  return [...map.values()];
};

export const listPersonaSummaries = (): IPersonaSummary[] =>
  listPersonas().map(({ text: _text, ...summary }) => summary);

export const readPersonaCard = (id: string): IPersonaCard | null => {
  if (!isSafePersonaId(id)) return null;

  const userFile = join(config.paths.userPersonaDir, `${id}.md`);
  const user = cardFromFile(userFile, id, "user");
  if (user) return user;

  const builtinFile = join(config.paths.personaDir, `${id}.md`);
  return cardFromFile(builtinFile, id, "builtin");
};

export const getActivePersonaId = (): string => {
  try {
    if (!existsSync(config.paths.activePersonaFile)) return DEFAULT_PERSONA_ID;

    const parsed: unknown = JSON.parse(
      stripBom(readFileSync(config.paths.activePersonaFile, "utf8")),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_PERSONA_ID;
    }

    const id = (parsed as { id?: unknown }).id;
    return typeof id === "string" && isSafePersonaId(id)
      ? id
      : DEFAULT_PERSONA_ID;
  } catch (error) {
    slog("读取当前人格失败，使用默认人格", error);
    return DEFAULT_PERSONA_ID;
  }
};

export const getActivePersonaCard = (): IPersonaCard => {
  const active = readPersonaCard(getActivePersonaId());
  if (active) return active;

  const fallback = readPersonaCard(DEFAULT_PERSONA_ID);
  if (fallback) return fallback;

  return {
    id: DEFAULT_PERSONA_ID,
    name: "DeepSeek 小鲸鱼",
    description: "最小兜底人格",
    source: "builtin",
    path: "",
    chars: MINIMAL_PERSONA.length,
    text: MINIMAL_PERSONA,
  };
};

/** 人设里的占位符与旧「主人」称呼替换；新卡建议用 {{ownerName}} */
export const renderPersonaText = (text: string): string => {
  const owner = config.persona.ownerName.trim() || "主人";
  let out = text.split("{{ownerName}}").join(owner);
  if (owner !== "主人") out = out.split("主人").join(owner);
  return out.trim();
};

export const getPersonaText = (): string =>
  renderPersonaText(getActivePersonaCard().text);

/** 创建用户人格目录，并补齐 active.json；幂等 */
export const ensurePersonaLayout = (): void => {
  try {
    mkdirSync(config.paths.userPersonaDir, { recursive: true });

    if (!existsSync(config.paths.activePersonaFile)) {
      writeJsonAtomic(config.paths.activePersonaFile, {
        id: DEFAULT_PERSONA_ID,
        updatedAt: Date.now(),
      });
    }
  } catch (error) {
    slog("初始化人格目录失败", error);
  }
};
