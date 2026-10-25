export const getAccessToken: () => Promise<string> = async () => {
  const qqAppID = process.env.QQBOT_APPID;
  const qqAppSecret = process.env.QQBOT_SECRET;

  const res = await fetch("https://bots.qq.com/app/getAppAccessToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      appId: qqAppID,
      clientSecret: qqAppSecret,
    }),
  });

  const getData = await res.json();
  return getData.access_token;
};
