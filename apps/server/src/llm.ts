interface IMessages {
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
}

const apikey = process.env.DEEPSEEK_API_KEY;

export const AIReply = async (messages: IMessages) => {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apikey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-flash",
      messages: messages.messages,
      stream: false,
    }),
  });

  return res;
};
