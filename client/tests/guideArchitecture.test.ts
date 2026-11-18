import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const folder = path.resolve(
  import.meta.dirname,
  "../src/Frontend/Panes/BoothGuide"
);
const files = fs.readdirSync(folder).filter((name) => /\.tsx?$/.test(name));
const graph = new Map<string, string[]>();
for (const name of files) {
  const source = ts.createSourceFile(
    name,
    fs.readFileSync(path.join(folder, name), "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const dependencies: string[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const clause = statement.importClause;
    if (clause?.isTypeOnly) continue;
    if (
      !clause?.name &&
      clause?.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.every((item) => item.isTypeOnly)
    )
      continue;
    const dependency = statement.moduleSpecifier.text;
    if (dependency.startsWith("./")) dependencies.push(dependency.slice(2));
  }
  graph.set(name.replace(/\.tsx?$/, ""), dependencies);
}

test("guide modules have no runtime import cycles", () => {
  function visit(name: string, ancestors: string[]) {
    assert.ok(
      !ancestors.includes(name),
      `Import cycle: ${[...ancestors, name].join(" -> ")}`
    );
    for (const dependency of graph.get(name) ?? [])
      visit(dependency, [...ancestors, name]);
  }
  for (const name of graph.keys()) visit(name, []);
});

test("chapters depend on shared contracts/adapters rather than each other or the panel", () => {
  const chapters = [
    "PlanetPage",
    "MovePage",
    "ShipPage",
    "FogPage",
    "ControlsPage",
    "ReviewPage",
  ];
  for (const chapter of chapters)
    for (const dependency of graph.get(chapter) ?? [])
      assert.ok(
        ![
          ...chapters,
          "BoothGuidePane",
          "GuidePanel",
          "GuideOverlay",
          "useGuideController",
        ].includes(dependency),
        `${chapter} depends on ${dependency}`
      );
  for (const name of [
    "GuidePanel",
    "GuideOverlay",
    "guidePlanets",
    "guideWorld",
    "guideEnergy",
    "guideDeselect",
    "guideTypes",
  ])
    for (const dependency of graph.get(name) ?? [])
      assert.ok(
        ![...chapters, "guidePages", "BoothGuidePane"].includes(dependency),
        `${name} depends on ${dependency}`
      );
});
