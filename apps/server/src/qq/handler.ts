import { AIReply } from "../llm.js";
import { getPersona } from "../persona.js";
import { sendC2C } from "./send.js";
import { loadHistory, saveHistory } from "./history.js";

export const handler = async (
  userId: string,
  msgId: string,
  token: string,
  content: string,
  images: Array<{ data: ArrayBuffer; mime: string }>,
) => {
  const historys = loadHistory(userId);
  if (historys.length === 0)
    historys.push({ role: "system", content: getPersona() });
  historys.push({ role: "user", content });

  const apply = await AIReply(historys);

  await sendC2C(userId, msgId, token, apply);

  historys.push({ role: "assistant", content: apply });
  saveHistory(userId, historys);
};
