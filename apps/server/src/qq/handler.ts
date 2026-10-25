import { AIReply } from "../llm.js";
import { getPersona } from "../persona.js";
import { sendC2C } from "./send.js";

interface IMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// key 是 user，记录不同用户的聊天记录
const messageMap = new Map<string, IMessage[]>();

export const handler = async (
  userId: string,
  msgId: string,
  token: string,
  content: string,
) => {
  const historys = messageMap.get(userId) || [
    { role: "system", content: getPersona() },
  ];
  historys.push({ role: "user", content });

  const apply = await AIReply({ messages: historys });

  await sendC2C(userId, msgId, token, apply);

  historys.push({ role: "assistant", content: apply });
  messageMap.set(userId, historys);
};
