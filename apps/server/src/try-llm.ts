import { AIReply } from "./llm.js";

const res = await AIReply({
  messages: [
    {
      role: "user",
      content: "请你做一个自我介绍",
    },
  ],
});

console.log(res);
