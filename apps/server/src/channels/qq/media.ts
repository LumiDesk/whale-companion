import { config } from "../../config.js";
import type { IImageInput } from "../../types/message.js";

const tooBig = (size: number) =>
  `图片过大 ${(size / 1024 / 1024).toFixed(1)}MB > ${(
    config.media.maxBytes /
    1024 /
    1024
  ).toFixed(1)}MB`;

/**
 * 下载 QQ 附件里的图片，返回字节 + MIME；过大或不是图片就拒绝。
 * 用流式读取，避免服务端不返回 content-length 时把整张图先读进内存。
 */
export const downloadImage = async (url: string): Promise<IImageInput> => {
  let res: Response;

  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`图片下载失败（30 秒超时或网络错误）：${reason}`);
  }

  if (!res.ok) throw new Error(`图片下载失败 ${res.status}`);

  const mime = res.headers.get("content-type") ?? "image/jpeg";
  if (!mime.startsWith("image/")) {
    throw new Error(`附件不是图片：${mime}`);
  }

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > config.media.maxBytes) throw new Error(tooBig(declared));

  const reader = res.body?.getReader();
  if (!reader) {
    const data = await res.arrayBuffer();
    if (data.byteLength > config.media.maxBytes) {
      throw new Error(tooBig(data.byteLength));
    }
    return { data, mime };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > config.media.maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(tooBig(total));
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { data: merged.buffer, mime };
};
