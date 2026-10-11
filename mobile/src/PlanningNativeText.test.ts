import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
it("keeps literal JSX text inside native Text in all M8 planning and goal consumers", () => {
  const failures: string[] = [];
  const directory = join(import.meta.dirname);
  for (const file of readdirSync(directory).filter(
    (f) =>
      /^(PlanningScreen|GoalsScreen|GoalScreen|GoalMeasurementForm|GoalMetadataForm|GoalEvidencePicker|GoalReminderPreferences).*\.tsx$/.test(
        f,
      ) && !f.includes(".test."),
  )) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(directory, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node: ts.Node, text = false) {
      if (ts.isJsxElement(node))
        text = node.openingElement.tagName.getText(source) === "Text";
      if (
        (ts.isJsxText(node) && node.text.trim()) ||
        (ts.isJsxExpression(node) &&
          node.expression &&
          ts.isStringLiteral(node.expression) &&
          node.expression.text)
      ) {
        if (!text)
          failures.push(
            file +
              ":" +
              (source.getLineAndCharacterOfPosition(node.getStart(source))
                .line +
                1),
          );
      }
      ts.forEachChild(node, (child) => visit(child, text));
    }
    visit(source);
  }
  expect(failures).toEqual([]);
});

it("gives the measurement sheet exactly one virtualized scroll owner and a stable element header", () => {
  const screen = readFileSync(
    join(import.meta.dirname, "GoalScreen.tsx"),
    "utf8",
  );
  const picker = readFileSync(
    join(import.meta.dirname, "GoalEvidencePicker.tsx"),
    "utf8",
  );
  expect(screen).toMatch(/<Sheet\s+scroll=\{false\}\s+title=\{correction/);
  expect((picker.match(/<FlatList/g) ?? []).length).toBe(1);
  expect(picker).not.toContain("<ScrollView");
  expect(picker).toMatch(/ListHeaderComponent=\{\s*<View/);
});
