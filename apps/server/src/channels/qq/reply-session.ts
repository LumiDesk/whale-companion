const MAX_PASSIVE_REPLIES = 4;
const MAX_TRACKED_MSG_IDS = 32;

/**
 * 被动回复预算：按 msg_id 记账。
 * QQ 官方 C2C：同一 msg_id 最多 4 条，msg_seq 从 1 递增，重复会失败。
 * 命令、Agent 回合、等待期间的新消息可能指向不同的 msg_id，所以必须按消息分别计数。
 */
export class ReplySession {
  private current: string | null = null;
  private readonly counts = new Map<string, number>();

  get msgId(): string | null {
    return this.current;
  }

  get remaining(): number {
    return this.remainingOf(this.current);
  }

  remainingOf(msgId: string | null = this.current): number {
    if (!msgId) return 0;
    return Math.max(0, MAX_PASSIVE_REPLIES - (this.counts.get(msgId) ?? 0));
  }

  /** 切到新消息；计数仍按各自 msg_id 保留 */
  switchTo(msgId: string): void {
    if (!msgId) return;

    this.current = msgId;
    if (!this.counts.has(msgId)) {
      this.counts.set(msgId, 0);
      this.prune();
    }
  }

  nextSeq(msgId: string | null = this.current): number {
    if (!msgId) throw new Error("当前没有可用的被动回复 msg_id");

    this.switchTo(msgId);
    const used = this.counts.get(msgId) ?? 0;
    if (used >= MAX_PASSIVE_REPLIES) {
      throw new Error("REPLY_QUOTA_EXCEEDED");
    }

    this.counts.set(msgId, used + 1);
    return used + 1;
  }

  private prune(): void {
    while (this.counts.size > MAX_TRACKED_MSG_IDS) {
      const oldest = this.counts.keys().next().value;
      if (typeof oldest !== "string") return;
      this.counts.delete(oldest);
    }
  }
}
