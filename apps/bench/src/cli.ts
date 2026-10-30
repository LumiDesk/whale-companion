import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildReport } from "./report.js";
import { VARIANTS, findVariant } from "./variants.js";
import type { IRun, IVariantResult } from "./types.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(here, "..");
const repoRoot = resolve(appRoot, "..", "..");

interface ILocalConfig {
  llm?: {
    apiKey?: unknown;
    baseUrl?: unknown;
    model?: unknown;
  };
}

const argOf = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const flagOf = (name: string): boolean => process.argv.includes(`--${name}`);

const stamp = (): string =>
  new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);

const defaultConfigPath = (): string => {
  const appData = process.env.APPDATA;
  if (!appData)
    throw new Error("找不到 APPDATA，请用 --config 指定 config.json");
  return join(appData, "whale-companion", "config.json");
};

const loadConfig = (path: string) => {
  if (!existsSync(path)) {
    throw new Error(`找不到配置文件：${path}（可以用 --config 指定）`);
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as ILocalConfig;
  const apiKey =
    typeof raw.llm?.apiKey === "string" ? raw.llm.apiKey.trim() : "";
  const baseUrl =
    typeof raw.llm?.baseUrl === "string" && raw.llm.baseUrl.trim()
      ? raw.llm.baseUrl.trim().replace(/\/+$/, "")
      : "https://api.deepseek.com";
  const model =
    typeof raw.llm?.model === "string" && raw.llm.model.trim()
      ? raw.llm.model.trim()
      : "deepseek-flash";

  if (!apiKey) throw new Error("config.json 里没有 llm.apiKey");

  return { apiKey, baseUrl, model };
};

const hashOf = (text: string): number => {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const rngOf = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffle = <T>(items: T[], seed: number): T[] => {
  const out = [...items];
  const random = rngOf(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const runChild = (args: string[], env: NodeJS.ProcessEnv): Promise<void> =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, {
      cwd: appRoot,
      env,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`子进程退出码 ${code ?? "?"}`));
    });
  });

const copyIfExists = (source: string, target: string): boolean => {
  if (!existsSync(source)) return false;
  cpSync(source, target);
  return true;
};

const main = async (): Promise<void> => {
  const configPath = argOf("config") ?? defaultConfigPath();
  const config = loadConfig(configPath);

  const model = argOf("model") ?? config.model;
  const requested = (argOf("variants") ?? VARIANTS.map((v) => v.id).join(","))
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const variants = requested.map((id) => {
    const variant = findVariant(id);
    if (!variant) throw new Error(`未知变体：${id}`);
    return variant;
  });

  const scenarioArg = argOf("scenarios");
  const runId = stamp();
  const runDir = resolve(
    process.cwd(),
    argOf("out") ?? join(appRoot, "out", runId),
  );

  mkdirSync(runDir, { recursive: true });

  console.log(`运行目录：${runDir}`);
  console.log(`模型：${model} / 变体：${variants.map((v) => v.id).join(", ")}`);

  const jobs = variants.map(async (variant) => {
    const promptDir = join(runDir, "prompts", variant.id);
    const personaDir = join(promptDir, "personas");
    const userPersonaDir = join(promptDir, "user-personas");
    const promptsDir = join(promptDir, "prompts");

    mkdirSync(personaDir, { recursive: true });
    mkdirSync(userPersonaDir, { recursive: true });

    cpSync(join(repoRoot, "apps", "server", "personas"), personaDir, {
      recursive: true,
    });
    cpSync(join(repoRoot, "apps", "server", "prompts"), promptsDir, {
      recursive: true,
    });

    if (variant.promptSource) {
      const sourceDir = join(appRoot, "variants", variant.promptSource);

      if (
        copyIfExists(
          join(sourceDir, "persona.md"),
          join(personaDir, "deepseek-whale.md"),
        )
      ) {
        console.log(`[${variant.id}] 使用自定义人格卡`);
      }

      if (
        copyIfExists(
          join(sourceDir, "behavior.md"),
          join(promptsDir, "behavior", "base.md"),
        )
      ) {
        console.log(`[${variant.id}] 使用自定义行为层`);
      }
    }

    writeFileSync(
      join(userPersonaDir, "active.json"),
      `${JSON.stringify({ id: "deepseek-whale" }, null, 2)}\n`,
      "utf8",
    );

    const dataDir = join(runDir, "data", variant.id);
    mkdirSync(dataDir, { recursive: true });

    const outFile = join(runDir, `${variant.id}.json`);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DEEPSEEK_API_KEY: config.apiKey,
      DEEPSEEK_BASE_URL: config.baseUrl,
      DEEPSEEK_MODEL: model,
      DEEPSEEK_THINKING_EFFORT: variant.sampling.thinkingEffort,
      DEEPSEEK_TEMPERATURE:
        variant.sampling.temperature === null
          ? ""
          : String(variant.sampling.temperature),
      DEEPSEEK_EXTRA_BODY: JSON.stringify(variant.sampling.extraBody),
      DEEPSEEK_TIMEOUT_MS: "60000",
      DEEPSEEK_RETRIES: "1",
      WEB_SEARCH_ENABLED: "true",
      WEB_SEARCH_MAX_RESULTS: "5",
      WEB_FETCH_MAX_CHARS: "6000",
      QQBOT_APPID: "bench-app",
      QQBOT_SECRET: "bench-secret",
      WHALE_DATA_DIR: dataDir,
      WHALE_PERSONA_DIR: personaDir,
      WHALE_USER_PERSONA_DIR: userPersonaDir,
      WHALE_ACTIVE_PERSONA_FILE: join(userPersonaDir, "active.json"),
      WHALE_PROMPTS_DIR: promptsDir,
      WHALE_GUI: "0",
      LOG_LEVEL: argOf("log-level") ?? "warn",
    };

    const args = [
      "--import",
      "tsx",
      join(appRoot, "src", "run-variant.ts"),
      "--variant",
      variant.id,
      "--out",
      outFile,
      ...(scenarioArg ? ["--scenarios", scenarioArg] : []),
    ];

    if (flagOf("dry-run")) {
      console.log(`[${variant.id}] dry-run：${args.join(" ")}`);
      return null;
    }

    await runChild(args, env);

    const result = JSON.parse(readFileSync(outFile, "utf8")) as IVariantResult;

    return result;
  });

  const settled = await Promise.allSettled(jobs);

  if (flagOf("dry-run")) {
    console.log("dry-run 完成：没有调用模型、没有生成报告");
    return;
  }

  const failures = settled.filter(
    (item): item is PromiseRejectedResult => item.status === "rejected",
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`变体失败：${String(failure.reason)}`);
    }
    throw new Error(`${failures.length} 个变体运行失败`);
  }

  const results = settled
    .map((item) => (item.status === "fulfilled" ? item.value : null))
    .filter((item): item is IVariantResult => item !== null);

  if (results.length === 0) throw new Error("没有产生任何结果");

  const scenarioIds = results[0].scenarios.map((scenario) => scenario.id);
  const variantIds = results.map((result) => result.variant);
  const mapping: IRun["mapping"] = {};

  for (const scenarioId of scenarioIds) {
    const order = shuffle(variantIds, hashOf(`${runId}:${scenarioId}`));
    mapping[scenarioId] = Object.fromEntries(
      order.map((variantId, index) => [`版本 ${index + 1}`, variantId]),
    );
  }

  const run: IRun = {
    runId,
    startedAt: new Date().toISOString(),
    model,
    variants: results,
    mapping,
  };

  const report = buildReport(run);
  const htmlPath = join(runDir, "report.html");
  const mdPath = join(runDir, "report.md");
  const jsonPath = join(runDir, "results.json");

  writeFileSync(jsonPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  writeFileSync(htmlPath, report.html, "utf8");
  writeFileSync(mdPath, report.markdown, "utf8");

  console.log("\n完成：");
  console.log(`  ${results.length} 个变体 / ${scenarioIds.length} 个场景`);
  console.log(`  报告：${htmlPath}`);
  console.log(`  文本：${mdPath}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
