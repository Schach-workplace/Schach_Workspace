/** Layouts are content-relative; persisted offset is row top relative to viewport. */
export class ConversationViewport {
  private rows = new Map<string, { top: number; height: number }>();
  private scrollTop = 0;
  measure(id: string, top: number, height: number) {
    this.rows.set(id, { top, height });
  }
  scroll(top: number) {
    this.scrollTop = top;
  }
  reset() {
    this.rows.clear();
    this.scrollTop = 0;
  }
  capture() {
    const row = [...this.rows]
      .filter(([, r]) => r.top + r.height > this.scrollTop)
      .sort((a, b) => a[1].top - b[1].top)[0];
    return row
      ? { anchorId: row[0], offset: row[1].top - this.scrollTop }
      : null;
  }
  restore(position: { anchorId?: string; offset?: number }) {
    const row = position.anchorId
      ? this.rows.get(position.anchorId)
      : undefined;
    return row ? Math.max(0, row.top - (position.offset ?? 0)) : null;
  }
}
