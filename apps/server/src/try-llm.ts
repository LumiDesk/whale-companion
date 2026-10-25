import { AIReply } from "./llm.js";
import { getPersona } from "./persona.js";

const persona = getPersona();

const res = await AIReply({
  messages: [
    { role: "system", content: persona },
    {
      role: "user",
      content: "你是谁呀",
    },
  ],
});

console.log(res);
