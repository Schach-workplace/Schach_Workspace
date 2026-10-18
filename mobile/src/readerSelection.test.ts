import { expect, it } from "vitest";
import { selectablePeople } from "./personSelection";
it("allows active viewers only for an explicitly readable publication audience, preserving default reviewer restrictions", () => {
  const people = [
    { id: "m", name: "Member", active: true, role: "member" },
    { id: "v", name: "Viewer", active: true, role: "viewer" },
    { id: "gone", name: "Departed", active: false, role: "member" },
  ];
  expect(selectablePeople(people).map((p) => p.id)).toEqual(["m"]);
  expect(selectablePeople(people, [], "", true).map((p) => p.id)).toEqual([
    "m",
    "v",
  ]);
  expect(selectablePeople(people, ["v"], "", true).map((p) => p.id)).toEqual([
    "m",
  ]);
});
