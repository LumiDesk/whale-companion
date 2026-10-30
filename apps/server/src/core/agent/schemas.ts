import type { IToolDefinition } from "../../types/message.js";

export const TOOL_SCHEMAS: readonly IToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "send_message",
      description:
        "把你要说的话发给他。文本输出不会自动发送，所有发言都必须调用这个工具。默认一次传 1~3 条（最多 4 条），每条是一个完整意群；每条不要包含换行，有换行会被自动拆成多条。不要用空格假装分条。",
      parameters: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            items: { type: "string" },
            description:
              "要发送的消息，默认 1~3 条，每条 1~200 字；不要超过工具返回的 remaining",
          },
          gap_ms: {
            type: "integer",
            description: "可选，条间基础间隔毫秒；不传由程序随机",
          },
        },
        required: ["messages"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wait_for_messages",
      description:
        "等他继续发消息。想确认他说完没有、想等他补充、或刚问完问题想等他回时用。返回这段时间的新消息；没有新消息会等到 timeout。",
      parameters: {
        type: "object",
        properties: {
          timeout_ms: {
            type: "integer",
            description:
              "最长等待毫秒，默认 15000，最大以 agent.waitMaxMs 设置为准（默认 20000）",
          },
          quiet_ms: {
            type: "integer",
            description: "收到新消息后至少再等多久算说完，默认 4000",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "联网搜索网页。问事实、时事、版本、价格、人物、地点，或你不确定时先搜；一次一个关键词，可以换词多搜 2~3 次。返回标题、链接和摘要；需要正文再用 web_fetch。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词，1~128 字；支持 site: / after: 等运算符",
          },
          count: {
            type: "integer",
            description: "要几条结果，默认 5，最多 10",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "打开一个网页并读取正文（Markdown）。搜到结果后对最相关的 1~2 条用；只接受 http / https 链接。",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "要打开的网页链接，必须是 http / https",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_sticker",
      description:
        "从图库发一张表情包。一条只能一张，不能附带文字；想说话先 send_message，再单独发。",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description:
              "描述当下情绪/场景的关键词，如委屈巴巴、无语翻白眼；不传则随机挑一张",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stay_silent",
      description:
        "这次选择不回复。只能单独调用，不能和发送工具混在一起。直接提问、连续沉默 3 次、他明显难过时会被拒绝。",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            enum: [
              "user_ended",
              "late_night",
              "nothing_to_add",
              "wait_for_more",
              "not_addressed",
              "other",
            ],
            description: "沉默原因",
          },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "记下值得长期记住的事。只有他明确说记住、反复强调的偏好、或对你很重要的事才用；不要逐条记笔记。",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["fact", "topic", "thought"],
            description:
              "fact=稳定事实；topic=没聊完的话题；thought=想说但没说的话",
          },
          text: {
            type: "string",
            description: "内容，最多 200 字",
          },
          pending_question: {
            type: "string",
            description: "topic 可选：待追问的问题，最多 200 字",
          },
          expires_in_minutes: {
            type: "integer",
            description: "thought 可选：多少分钟后过期，默认 120，范围 5~1440",
          },
        },
        required: ["kind", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_next_wake",
      description:
        "设定下一次主动开口的时间。只有真的想再找他说话时才用；不要每轮都设。",
      parameters: {
        type: "object",
        properties: {
          after_minutes: {
            type: "integer",
            description: "多少分钟后，范围 15~720",
          },
          intent: {
            type: "string",
            description: "一句话说明你想说什么，最多 100 字",
          },
          allow_silent: {
            type: "boolean",
            description: "到点后如果没话说，是否允许沉默；默认 true",
          },
        },
        required: ["after_minutes", "intent"],
      },
    },
  },
];
