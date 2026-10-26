import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

const tempPathOf = (file: string): string =>
  `${file}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 8)}.tmp`;

/**
 * 先写临时文件、fsync、再 rename 覆盖目标。
 * 这样进程在写一半时崩溃，旧文件仍然是完整的，不会留下半截 JSON。
 */
export const writeFileAtomic = (file: string, data: string): void => {
  mkdirSync(dirname(file), { recursive: true });

  const temp = tempPathOf(file);
  let fd: number | null = null;

  try {
    fd = openSync(temp, "w");

    const bytes = Buffer.from(data, "utf8");
    let offset = 0;

    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error("写入临时文件时没有进展");
      offset += written;
    }

    try {
      fsyncSync(fd);
    } catch {
      // 某些文件系统 / 网络盘不支持 fsync；写入本身已经完成，不因此失败
    }

    closeSync(fd);
    fd = null;

    try {
      renameSync(temp, file);
    } catch (error) {
      // Windows 上极少数情况会因目标被短暂占用而 rename 失败，重试一次
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") {
        throw error;
      }

      rmSync(file, { force: true });
      renameSync(temp, file);
    }
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // 关闭失败时已经要抛原始错误了
      }
    }
    rmSync(temp, { force: true });
    throw error;
  }
};

/** JSON 统一格式：两空格缩进 + 结尾换行 */
export const writeJsonAtomic = (file: string, value: unknown): void => {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
};
