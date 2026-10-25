import { readFileSync } from "node:fs";

import { config } from "../config.js";

/** 读人设正文；每次现读，改完 persona.md 下一轮就生效 */
export const getPersona = (): string =>
  readFileSync(config.paths.persona, "utf8").trim();
