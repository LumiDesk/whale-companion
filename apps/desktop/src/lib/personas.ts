import type { IPersonaCard } from "./types";

export const DEFAULT_PERSONA_ID = "deepseek-whale";

const RESERVED = new Set([
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

export const isSafePersonaId = (id: string): boolean => {
  if (!/^[\p{L}\p{N}_-]{1,48}$/u.test(id)) return false;
  return !RESERVED.has(id.toLowerCase());
};

export const normalizePersonaText = (raw: string): string =>
  raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();

export const personaNameFromText = (text: string, fallback: string): string => {
  const match = /^#\s+(.+)$/m.exec(text);
  if (!match) return fallback;

  return (
    match[1]
      .replace(/^角色卡[：:]\s*/u, "")
      .replace(/\s+/g, " ")
      .trim() || fallback
  );
};

export const personaDescriptionFromText = (text: string): string => {
  const lines = text.split("\n");
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

const slugOf = (name: string): string => {
  const slug = name
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug && isSafePersonaId(slug) ? slug : "custom";
};

export const uniquePersonaId = (
  name: string,
  existing: ReadonlySet<string>,
): string => {
  const base = slugOf(name);
  if (!existing.has(base)) return base;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`.slice(0, 48);
    if (!existing.has(candidate)) return candidate;
  }

  return `custom-${Date.now()}`;
};

export const personaTemplate = (name: string): string =>
  [
    `# ${name || "自定义人格"}`,
    "",
    "## 你是谁",
    "",
    "在这里写她是谁、和你是什么关系、性格和说话方式。",
    "",
    "## 怎么说话",
    "",
    "- 句子短一点，像聊天，不像文章。",
    "- 不要客服腔，不要总结，不要动不动讲道理。",
    "",
    "## 边界",
    "",
    "- 不假装能出门、打电话、操作电脑；不索要账号密码。",
    "",
  ].join("\n");

export interface IPersonaFileEntry {
  id: string;
  name: string;
  text: string;
}

/** 从目录读到的原始条目转成卡片摘要；description 由界面自行展示 */
export const summarizePersona = (
  entry: IPersonaFileEntry,
  source: IPersonaCard["source"],
  path: string,
): IPersonaCard => ({
  id: entry.id,
  name: personaNameFromText(entry.text, entry.name || entry.id),
  description: personaDescriptionFromText(entry.text),
  source,
  path,
  chars: entry.text.length,
  text: entry.text,
});

export const parseActivePersonaId = (raw: string | null | undefined): string => {
  if (!raw) return DEFAULT_PERSONA_ID;

  try {
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_PERSONA_ID;
    }

    const id = (parsed as { id?: unknown }).id;
    return typeof id === "string" && isSafePersonaId(id)
      ? id
      : DEFAULT_PERSONA_ID;
  } catch {
    return DEFAULT_PERSONA_ID;
  }
};

export const activePersonaJson = (id: string): string =>
  `${JSON.stringify({ id, updatedAt: Date.now() }, null, 2)}\n`;

export const sortPersonas = (cards: IPersonaCard[]): IPersonaCard[] =>
  [...cards].sort((a, b) => {
    if (a.source !== b.source) return a.source === "builtin" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
