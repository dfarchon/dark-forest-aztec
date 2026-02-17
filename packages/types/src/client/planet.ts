import type { Planet } from "../world/planet";
import type { WorldLocation } from "../world/world";
import type { Biome } from "../world/game_types";

/**
 * A planet whose coordinates are known to the client.
 */
export type LocatablePlanet = Planet & {
  location: WorldLocation;
  biome: Biome;
};

/**
 * A structure with default stats of planets in nebula at corresponding levels.
 */
export interface PlanetDefaults {
  populationCap: number[];
  populationGrowth: number[];
  range: number[];
  speed: number[];
  defense: number[];
  silverGrowth: number[];
  silverCap: number[];
  barbarianPercentage: number[];
}

export class DFAnimation {
  private readonly _update: () => number;
  private _value: number;

  public constructor(update: () => number) {
    this._update = update;
    this._value = 0;
  }

  public update(): number {
    this._value = this._update();
    return this._value;
  }

  public value(): number {
    return this._value;
  }
}

export class DFStatefulAnimation<T> extends DFAnimation {
  private readonly _state: T;

  public constructor(state: T, update: () => number) {
    super(update);
    this._state = state;
  }

  public state(): T {
    return this._state;
  }
}
