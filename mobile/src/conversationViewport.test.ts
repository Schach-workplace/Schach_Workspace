import { expect, it } from "vitest";
import { ConversationViewport } from "./conversationViewport";
it("restores canonical row relative offset after fresh wrapped heights above it change", () => {
  const before = new ConversationViewport();
  before.measure("a", 0, 100);
  before.measure("anchor", 100, 80);
  before.scroll(115);
  expect(before.capture()).toEqual({ anchorId: "anchor", offset: -15 });
  const after = new ConversationViewport();
  after.measure("a", 0, 240);
  after.measure("anchor", 240, 120);
  expect(after.restore({ anchorId: "anchor", offset: -15 })).toBe(255);
});
it("waits for an offscreen anchor measurement and chooses first partially visible row", () => {
  const view = new ConversationViewport();
  view.measure("a", 0, 100);
  view.measure("b", 100, 200);
  view.scroll(75);
  expect(view.capture()).toEqual({ anchorId: "a", offset: -75 });
  expect(view.restore({ anchorId: "unknown", offset: -15 })).toBeNull();
});
