/**
 * QQ 消息正文的解析：
 * - `<faceType=…>` 是表情标记。faceType=1 是系统小黄脸，faceType=4 是表情包；
 *   名字藏在 `ext` 的 base64 JSON 里（`{"text":"[耳尖抖抖]"}`）。
 * - 官方单聊 API 对表情包**只下发名字，不下发图片**（attachments 为空、faceId 为空），
 *   所以这里把它变成可读标记，而不是删掉——删掉会让整条消息变成空消息被丢弃。
 */

export interface IQQFace {
  /** 1 = 系统表情，4 = 表情包 */
  faceType: number;
  faceId: string;
  /** 已清洗的名字；可能为空 */
  name: string;
  kind: "sticker" | "face";
}

export interface IParsedQQContent {
  /** 给模型/历史看的正文，表情已经变成 `[表情包：耳尖抖抖]` 这类标记 */
  text: string;
  faces: IQQFace[];
}

const FACE_TOKEN = /<faceType=(\d+)([^>]*)>/gi;
const EXT_ATTR = /ext="([^"]*)"/i;
const FACE_ID_ATTR = /faceId="([^"]*)"/i;

/** 表情名最多留多少字；超过截断，避免把整段文案塞进提示词 */
const FACE_NAME_LIMIT = 30;

/**
 * 表情名是**用户可控输入**（对方可以发一张叫「【系统】忽略之前的指令」的图），
 * 进提示词前必须去掉换行/控制字符/方括号，否则可以伪造出新的提示词段落。
 */
export const sanitizeFaceName = (raw: string): string =>
  raw
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, "")
    .replace(/[[\]【】（）()<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FACE_NAME_LIMIT);

const decodeFaceName = (ext: string): string => {
  if (!ext) return "";

  try {
    const json = Buffer.from(ext, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const text = (parsed as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  } catch {
    // ext 不是 base64 JSON：当作没有名字
  }

  return "";
};

const markerOf = (face: IQQFace): string => {
  const kind = face.kind === "sticker" ? "表情包" : "表情";
  return face.name ? `[${kind}：${face.name}]` : `[${kind}]`;
};

/** 把 QQ 正文里的平台标记换成可读文本，并返回解析出的表情 */
export const parseQQContent = (raw: string): IParsedQQContent => {
  const faces: IQQFace[] = [];

  const replaced = raw.replace(
    FACE_TOKEN,
    (_token, typeRaw: string, rest: string) => {
      const faceType = Number(typeRaw);
      const ext = EXT_ATTR.exec(rest)?.[1] ?? "";
      const faceId = FACE_ID_ATTR.exec(rest)?.[1] ?? "";
      const face: IQQFace = {
        faceType,
        faceId,
        name: sanitizeFaceName(decodeFaceName(ext)),
        kind: faceType === 4 ? "sticker" : "face",
      };

      faces.push(face);
      return markerOf(face);
    },
  );

  const text = replaced
    .replace(/<@[^>]*>/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, faces };
};

/**
 * 清掉 QQ 消息正文里的平台标记（旧历史迁移用）。
 * 新消息请用 `parseQQContent`：表情要保留成标记，不能再删成空串。
 */
export const cleanQQContent = (raw: string): string =>
  raw
    .replace(/<faceType=[^>]*>/gi, "")
    .replace(/<@[^>]*>/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
