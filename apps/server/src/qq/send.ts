export const sendC2C = async (
  userId: string,
  msgId: string,
  token: string,
  text: string,
) => {
  const res = await fetch(
    `https://api.sgroup.qq.com/v2/users/${userId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `QQBot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: text,
        msg_type: 0,
        msg_id: msgId,
      }),
    },
  );
};
