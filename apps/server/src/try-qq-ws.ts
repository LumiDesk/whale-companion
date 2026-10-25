import { getAccessToken } from "./qq/token.js";

const token = await getAccessToken();

const gateway = await fetch("https://api.sgroup.qq.com/gateway", {
  headers: {
    Authorization: "QQBot " + token,
  },
});

const url: string = (await gateway.json()).url;

const ws = new WebSocket(url);

let lastSeq: number | null = null;

ws.onmessage = async (e) => {
  const data = JSON.parse(e.data);
  if (data.s) lastSeq = data.s;
  if (data.op === 10) {
    ws.send(
      JSON.stringify({
        op: 2,
        d: {
          token: "QQBot " + token,
          intents: 1 << 25,
          shard: [0, 1],
        },
      }),
    );
    setInterval(() => {
      ws.send(JSON.stringify({ op: 1, d: lastSeq }));
    }, data.d.heartbeat_interval);
  }

  if (data.t === "C2C_MESSAGE_CREATE") {
    const user_id = data.d.author.user_openid;
    const res = await fetch(
      `https://api.sgroup.qq.com/v2/users/${user_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `QQBot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: "收到啦 🐋",
          msg_type: 0,
          msg_id: data.d.id,
        }),
      },
    );

    console.log(await res.json());
  }

  console.log(data);
};

ws.onclose = (e) => {
  console.log("close", e);
};

ws.onerror = (e) => {
  console.log("error", e);
};
