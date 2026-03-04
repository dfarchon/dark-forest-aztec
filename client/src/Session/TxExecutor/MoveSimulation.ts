/**
 * Client-side simulation of contract refresh_planet logic.
 * Used to compute refreshed population/silver before submitting a move,
 * and to validate popMoved/silverMoved against them to avoid chain reverts.
 *
 * Matches: contracts/libs/src/lazy_update.nr (update_planet, apply_arrival, apply_pending_events)
 *          contracts/libs/src/planet.nr (get_refreshed_planet, apply_spaceship_arrive)
 */

import type {
  ArrivalState,
  ArtifactState,
  PlanetEventsState,
  PlanetState,
} from "../Indexer/TableTypes/chain";

// Contract enum values (u8)
const ArrivalTypeWormhole = 3;
const PlanetTypeSilverMine = 1;
const PlanetTypeSilverBank = 4;
const ArtifactTypeShipMothership = 10;
const ArtifactTypeShipWhale = 12;
const ArtifactTypeShipTitan = 14;

const MAX_U64 = 18446744073709551615n;
const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function toBigint(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  return BigInt(String(v ?? 0));
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v ?? 0);
}

/** Mutable planet state used during simulation (only fields that change). */
interface MutablePlanet {
  population: bigint;
  silver: bigint;
  last_updated: number;
  owner: string;
  population_cap: bigint;
  population_growth: bigint;
  pausers: bigint;
  planet_type: number;
  silver_cap: bigint;
  silver_growth: bigint;
  defense: bigint;
  is_home_planet: boolean;
  energy_gro_doublers: bigint;
  silver_gro_doublers: bigint;
}

function cloneToMutable(p: PlanetState): MutablePlanet {
  return {
    population: p.population,
    silver: p.silver,
    last_updated: Number(p.last_updated), // contract u64, seconds
    owner: p.owner,
    population_cap: p.population_cap,
    population_growth: p.population_growth,
    pausers: p.pausers,
    planet_type: p.planet_type,
    silver_cap: p.silver_cap,
    silver_growth: p.silver_growth,
    defense: p.defense,
    is_home_planet: p.is_home_planet,
    energy_gro_doublers: p.energy_gro_doublers,
    silver_gro_doublers: p.silver_gro_doublers,
  };
}

/** Noir update_population: linear growth, cap, pausers/SilverBank handling. */
function updatePopulation(updateToTime: number, planet: MutablePlanet): void {
  if (planet.owner !== ZERO_ADDRESS) {
    if (planet.population < planet.population_cap) {
      const timeDiff = BigInt(Math.max(0, updateToTime - planet.last_updated));
      const populationGained = planet.population_growth * timeDiff;
      const maxPop = planet.population_cap;
      const currentPop = planet.population + populationGained;
      const newPopulation = maxPop < currentPop ? maxPop : currentPop;
      if (planet.pausers === 0n) {
        planet.population = newPopulation;
      } else if (newPopulation <= planet.population) {
        planet.population = newPopulation;
      }
    }
  }
  if (planet.planet_type === PlanetTypeSilverBank) {
    if (planet.population > planet.population_cap) {
      planet.population = planet.population_cap;
    }
  }
  if (planet.pausers > 0n) {
    if (planet.population > planet.population_cap) {
      planet.population = planet.population_cap;
    }
  }
}

/** Noir update_silver: only for SilverMine, linear growth and cap. */
function updateSilver(updateToTime: number, planet: MutablePlanet): void {
  if (planet.planet_type !== PlanetTypeSilverMine) return;
  if (planet.owner !== ZERO_ADDRESS && planet.silver < planet.silver_cap) {
    const timeDiff = BigInt(Math.max(0, updateToTime - planet.last_updated));
    const silverMined = planet.silver_growth * timeDiff;
    const currentSilver = planet.silver + silverMined;
    planet.silver =
      planet.silver_cap < currentSilver ? planet.silver_cap : currentSilver;
  }
}

/** Noir update_planet: population, silver (if SilverMine), then set last_updated. */
function updatePlanet(updateToTime: number, planet: MutablePlanet): void {
  updatePopulation(updateToTime, planet);
  updateSilver(updateToTime, planet);
  planet.last_updated = updateToTime;
}

/** Arrival record shape (contract format or ArrivalState). */
interface ArrivalLike {
  player: string;
  pop_arriving: bigint;
  silver_moved: bigint;
  arrival_time: number;
  arrival_type: number;
}

function toArrivalLike(r: Record<string, unknown> | ArrivalState): ArrivalLike {
  if (
    "arrival_time" in r &&
    typeof (r as ArrivalState).arrival_time === "bigint"
  ) {
    const a = r as ArrivalState;
    return {
      player: a.player,
      pop_arriving: a.pop_arriving,
      silver_moved: a.silver_moved,
      arrival_time: Number(a.arrival_time), // contract u64, seconds
      arrival_type: a.arrival_type,
    };
  }
  const rec = r as Record<string, unknown>;
  return {
    player: String(rec.player ?? ZERO_ADDRESS),
    pop_arriving: toBigint(rec.pop_arriving),
    silver_moved: toBigint(rec.silver_moved),
    arrival_time: toNumber(rec.arrival_time), // contract u64, seconds
    arrival_type: toNumber(rec.arrival_type),
  };
}

/** Noir apply_arrival: same-owner add pop/silver; enemy attack/conquer; wormhole skip. */
function applyArrival(planet: MutablePlanet, arrival: ArrivalLike): void {
  if (arrival.player === planet.owner) {
    planet.population = planet.population + arrival.pop_arriving;
  } else {
    if (arrival.arrival_type === ArrivalTypeWormhole) {
      // no energy change
    } else if (
      planet.population >
      (arrival.pop_arriving * 100n) / planet.defense
    ) {
      planet.population =
        planet.population - (arrival.pop_arriving * 100n) / planet.defense;
    } else {
      planet.owner =
        arrival.player === ZERO_ADDRESS ? planet.owner : arrival.player;
      planet.population =
        arrival.pop_arriving - (planet.population * planet.defense) / 100n;
      if (planet.population === 0n) planet.population = 1n;
    }
  }
  if (planet.population > planet.population_cap) {
    planet.population = planet.population_cap;
  }
  const nextSilver = planet.silver + arrival.silver_moved;
  planet.silver =
    planet.silver_cap < nextSilver ? planet.silver_cap : nextSilver;
}

/** Noir apply_spaceship_arrive: only changes growth/pausers, not population/silver. */
function applySpaceshipArrive(
  planet: MutablePlanet,
  artifactType: number
): void {
  if (planet.is_home_planet) return;
  if (artifactType === ArtifactTypeShipMothership) {
    if (planet.energy_gro_doublers === 0n) {
      planet.population_growth = planet.population_growth * 2n;
    }
    planet.energy_gro_doublers += 1n;
  } else if (artifactType === ArtifactTypeShipWhale) {
    if (planet.silver_gro_doublers === 0n) {
      planet.silver_growth = planet.silver_growth * 2n;
    }
    planet.silver_gro_doublers += 1n;
  } else if (artifactType === ArtifactTypeShipTitan) {
    planet.pausers += 1n;
  }
}

function getArtifactType(art: Record<string, unknown> | ArtifactState): number {
  if (typeof (art as ArtifactState).artifact_type === "number") {
    return (art as ArtifactState).artifact_type;
  }
  return toNumber((art as Record<string, unknown>).artifact_type);
}

/**
 * Apply pending events in chronological order (matches lazy_update.apply_pending_events).
 * arrivals[i] corresponds to planet_events.events[i]; only indices < count are valid.
 * Returns indices into arrivals/artifacts for each arrival that carried an artifact (for apply_spaceship_arrive).
 */
function applyPendingEvents(
  currentTimestamp: number,
  planet: MutablePlanet,
  planetEvents: PlanetEventsState,
  arrivals: (Record<string, unknown> | ArrivalState)[]
): { artifactArrivalIndices: number[] } {
  const eventsToRemove = new Set<string>();
  const artifactArrivalIndices: number[] = [];
  const count = planetEvents.count ?? 0;
  const maxIter = 20;

  for (let iter = 0; iter < maxIter; iter++) {
    if (count === 0) break;

    let earliestTime = Number(MAX_U64);
    let earliestIndex = -1;

    for (let i = 0; i < 20; i++) {
      if (i >= count) continue;
      const ev = planetEvents.events[i];
      const arrival = arrivals[i];
      if (!arrival || !ev?.id) continue;
      const arrivalTime = toArrivalLike(arrival).arrival_time;
      if (arrivalTime >= earliestTime) continue;
      if (eventsToRemove.has(String(ev.id))) continue;
      earliestTime = arrivalTime;
      earliestIndex = i;
    }

    if (earliestIndex < 0 || earliestTime > currentTimestamp) break;
    if (earliestTime === Number(MAX_U64)) break;

    const arrivalLike = toArrivalLike(arrivals[earliestIndex]!);
    updatePlanet(arrivalLike.arrival_time, planet);
    const eventId = String(planetEvents.events[earliestIndex]!.id);
    eventsToRemove.add(eventId);
    applyArrival(planet, arrivalLike);

    const carried = arrivals[earliestIndex] as Record<string, unknown>;
    const carriedId = toBigint(carried?.carried_artifact_id ?? 0);
    if (carriedId !== 0n) {
      artifactArrivalIndices.push(earliestIndex);
    }
  }

  return { artifactArrivalIndices };
}

/**
 * Returns refreshed population and silver for the given planet at timestampSec,
 * matching contract get_refreshed_planet + update_planet(timestamp).
 * Uses indexer types for planet/planetEvents; arrivals can be contract-format records (length 20).
 */
export function getRefreshedPopulationAndSilver(
  timestampSec: number,
  planet: PlanetState,
  planetEvents: PlanetEventsState,
  arrivals: (Record<string, unknown> | ArrivalState)[],
  artifacts?: (Record<string, unknown> | ArtifactState)[]
): { population: bigint; silver: bigint; owner: string } {
  const mut = cloneToMutable(planet);

  const inputPop = mut.population;
  const inputLastUpdated = mut.last_updated;
  const inputGrowth = mut.population_growth;
  const inputCap = mut.population_cap;
  const eventCount = planetEvents.count ?? 0;

  const { artifactArrivalIndices } = applyPendingEvents(
    timestampSec,
    mut,
    planetEvents,
    arrivals
  );

  const popAfterEvents = mut.population;

  if (
    artifactArrivalIndices.length > 0 &&
    artifacts &&
    artifacts.length >= 20
  ) {
    for (const j of artifactArrivalIndices) {
      const art = artifacts[j];
      if (art) {
        applySpaceshipArrive(mut, getArtifactType(art));
      }
    }
  }

  updatePlanet(timestampSec, mut);

  console.log("[move sim] input:", {
    population: inputPop,
    populationGrowth: inputGrowth,
    populationCap: inputCap,
    lastUpdated: inputLastUpdated,
    timestampSec,
    timeDelta: timestampSec - inputLastUpdated,
    pendingEvents: eventCount,
    popAfterEvents,
    finalPopulation: mut.population,
    owner: mut.owner,
  });

  return {
    population: mut.population,
    silver: mut.silver,
    owner: mut.owner,
  };
}

export interface ValidateMoveForSubmitParams {
  isSpaceshipMove: boolean;
  sender: string;
  sourceOwner: string;
  sourceDestroyed: boolean;
}

/**
 * Validates non-clampable move preconditions (owner, destroyed).
 * Throws with a clear message if validation fails.
 */
export function validateMoveForSubmit(
  params: ValidateMoveForSubmitParams
): void {
  const { isSpaceshipMove, sender, sourceOwner, sourceDestroyed } = params;

  if (!isSpaceshipMove) {
    if (sourceDestroyed) {
      throw new Error("Planet is destroyed");
    }
    if (sourceOwner !== sender) {
      throw new Error(
        "Only owner account can perform that operation on planet."
      );
    }
  }
}

export interface ClampMoveForSubmitParams {
  refreshedPopulation: bigint;
  refreshedSilver: bigint;
  popMoved: bigint;
  silverMoved: bigint;
  isSpaceshipMove: boolean;
}

/**
 * Clamps popMoved/silverMoved to contract-safe ranges.
 *
 * Contract constraints matched:
 *   population > pop_moved   (strict >)
 *   silver    >= silver_moved
 */
export function clampMoveForSubmit(params: ClampMoveForSubmitParams): {
  popMoved: bigint;
  silverMoved: bigint;
} {
  const { refreshedPopulation, refreshedSilver, isSpaceshipMove } = params;
  let { popMoved, silverMoved } = params;

  if (isSpaceshipMove) {
    return { popMoved: 0n, silverMoved: 0n };
  }

  const origPop = popMoved;
  const origSilver = silverMoved;

  // Contract: population > pop_moved  (must leave at least 1 remaining)
  const maxPop = refreshedPopulation > 0n ? refreshedPopulation - 1n : 0n;
  if (popMoved > maxPop) {
    popMoved = maxPop;
  }
  if (popMoved < 1n) {
    popMoved = 1n;
  }

  // Contract: silver >= silver_moved
  if (silverMoved > refreshedSilver) {
    silverMoved = refreshedSilver;
  }

  if (popMoved !== origPop || silverMoved !== origSilver) {
    console.warn(
      `[MoveSimulation] clamped move values:`,
      `pop ${origPop} → ${popMoved} (refreshed=${refreshedPopulation})`,
      `silver ${origSilver} → ${silverMoved} (refreshed=${refreshedSilver})`
    );
  }

  return { popMoved, silverMoved };
}
