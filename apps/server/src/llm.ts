import { type IMessages } from "./types/message.js";

const apikey = process.env.DEEPSEEK_API_KEY;

export const AIReply = async (messages: IMessages) => {
  if (!apikey) throw new Error("缺少 DEEPSEEK_API_KEY");

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apikey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-flash",
      messages,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Code: ${res.status}; Error: ${errorText}`);
  }

  const content = await res.json();

  return content.choices[0].message.content;
};
