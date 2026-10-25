/** 一天一个心情（按 用户+日期 派生，同一天内稳定） */
const MOODS = [
  "心情不错，话比平时多一点，爱接梗",
  "有点困，回复懒懒的、句子更短",
  "嘴硬模式：嘴上不承认，但绝不冷场",
  "黏人模式：想被搭理，会主动找话",
  "小小别扭：偶尔哼一声，但不记仇，很好哄",
  "精神很好，想分享点自己的小事",
];

const fnv1a = (s: string): number => {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const dailyMood = (userId: string, now = new Date()): string => {
  const key = `${userId}|${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return MOODS[fnv1a(key) % MOODS.length];
};

/** 一天里的时段，用来调语气 */
export const timeOfDay = (now = new Date()): string => {
  const h = now.getHours();
  if (h < 5) return "凌晨";
  if (h < 9) return "清早";
  if (h < 12) return "上午";
  if (h < 14) return "中午";
  if (h < 18) return "下午";
  if (h < 22) return "晚上";
  return "深夜";
};

/** 时段带来的语气提示 */
export const toneHint = (now = new Date()): string => {
  const day = timeOfDay(now);
  switch (day) {
    case "凌晨":
      return "这个点该睡了，语气轻一点、别太吵";
    case "清早":
      return "刚醒的感觉，句子短、可以有点迷糊";
    case "深夜":
      return "夜深了，说话小声、别太兴奋";
    default:
      return "正常状态";
  }
};
