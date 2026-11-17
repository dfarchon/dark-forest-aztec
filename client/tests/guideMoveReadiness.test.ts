import assert from "node:assert/strict";
import test from "node:test";

import type GameUIManager from "../src/Backend/GameLogic/GameUIManager";
import { restoreGuideMoveSelection } from "../src/Frontend/Panes/BoothGuide/guideMoveReadiness";

function fixture() {
  const source = {
    locationId: "source",
    location: { coords: { x: 1, y: 2 } },
    energy: 100,
    destroyed: false,
  };
  let selected: typeof source | undefined = source;
  let owned = true;
  const selections: unknown[] = [];
  const ui = {
    getPlanetWithId: () => source,
    getSelectedPlanet: () => selected,
    isOwnedByMe: () => owned,
    setSelectedPlanet: (planet: typeof source) => {
      selected = planet;
      selections.push(planet);
    },
  } as unknown as GameUIManager;
  return {
    ui,
    source,
    selections,
    deselect: () => {
      selected = undefined;
    },
    loseOwnership: () => {
      owned = false;
    },
  };
}

test("a dismissed or deselected planet is reselected before the slider can resume", () => {
  const f = fixture();
  f.deselect();
  let visible = false;
  assert.equal(
    restoreGuideMoveSelection(
      f.ui,
      f.source.locationId as never,
      () => visible
    ),
    false
  );
  assert.equal(f.selections.length, 1);
  assert.equal(
    restoreGuideMoveSelection(
      f.ui,
      f.source.locationId as never,
      () => visible
    ),
    false
  );
  assert.equal(f.selections.length, 2); // Reopens even if selection stayed the same.
  visible = true;
  assert.equal(
    restoreGuideMoveSelection(
      f.ui,
      f.source.locationId as never,
      () => visible
    ),
    true
  );
  assert.equal(f.selections.length, 2);
});

test("recovery refuses a destroyed, depleted or no-longer-owned teaching planet", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => f.loseOwnership(),
    (f: ReturnType<typeof fixture>) => {
      f.source.destroyed = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.source.energy = 1;
    },
  ]) {
    const f = fixture();
    f.deselect();
    change(f);
    assert.equal(
      restoreGuideMoveSelection(f.ui, f.source.locationId as never, () => true),
      false
    );
    assert.deepEqual(f.selections, []);
  }
});
