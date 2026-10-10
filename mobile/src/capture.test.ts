import { expect, it } from "vitest";
import { CaptureOwner } from "./captureOwner";
const scope = {
  serverOrigin: "https://test",
  companyId: "c",
  userId: "u",
  targetKind: "task" as const,
  targetId: "t",
};
it("keeps a lost-confirmation file and requires recheck before a deliberate additive retry", async () => {
  let uploads = 0,
    deletes = 0;
  const owner = new CaptureOwner(scope);
  owner.select({
    uri: "cache.jpg",
    name: "photo.jpg",
    mime: "image/jpeg",
    size: 20,
    delete: () => deletes++,
  });
  await owner.upload(async () => {
    uploads++;
    throw Error("ACK lost");
  });
  expect(owner.state.phase).toBe("recheck");
  expect(deletes).toBe(0);
  await owner.upload(async () => {
    uploads++;
  });
  expect(uploads).toBe(1);
  await owner.recheck(async () => {});
  expect(owner.state.phase).toBe("preview");
  await owner.upload(async () => {
    uploads++;
  });
  expect(deletes).toBe(1);
  expect(owner.state.file).toBeNull();
});
it("rejects unsupported bytes or oversize and discards only owned preview on scope revocation", () => {
  let deleted = 0;
  const owner = new CaptureOwner(scope);
  expect(() =>
    owner.select({
      uri: "a",
      name: "a.heic",
      mime: "image/heic",
      size: 10,
      delete() {},
    }),
  ).toThrow();
  expect(() =>
    owner.select({
      uri: "a",
      name: "a.jpg",
      mime: "image/jpeg",
      size: 11 * 1024 * 1024,
      delete() {},
    }),
  ).toThrow();
  owner.select({
    uri: "a",
    name: "a.jpg",
    mime: "image/jpeg",
    size: 10,
    delete: () => deleted++,
  });
  owner.clear();
  expect(deleted).toBe(1);
  expect(owner.state.file).toBeNull();
});
