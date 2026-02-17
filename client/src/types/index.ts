/**
 * Frontend chain state types. Re-exports from chain and enums.
 * Use: import { PlanetState, PlanetType } from '@/types' or from './types'
 */

// Chain state types and entity types
export type {
  FieldId,
  AddressString,
  WorldState,
  PlayerState,
  PlanetState,
  PlanetRevealedCoordsState,
  PlanetEventMetadata,
  PlanetEventsState,
  PlanetArtifactsState,
  ArrivalState,
  ArtifactState,
  ArtifactLocationState,
  WorldEntity,
  PlayerEntity,
  PlanetEntity,
  PlanetRevealedCoordsEntity,
  PlanetEventsEntity,
  PlanetArtifactsEntity,
  ArrivalEntity,
  ArtifactEntity,
  ArtifactLocationEntity,
} from "./chain";

// Enum constants and name maps (values match contracts/types storage mods)
export {
  PlanetType,
  PlanetTypeName,
  SpaceType,
  SpaceTypeName,
  UpgradeBranch,
  UpgradeBranchName,
  Biome,
  BiomeName,
  PlanetEventType,
  PlanetEventTypeName,
  ArrivalType,
  ArrivalTypeName,
  ArtifactType,
  ArtifactTypeName,
  ArtifactRarity,
  ArtifactRarityName,
} from "./enums";

export type {
  PlanetTypeValue,
  SpaceTypeValue,
  UpgradeBranchValue,
  BiomeValue,
  PlanetEventTypeValue,
  ArrivalTypeValue,
  ArtifactTypeValue,
  ArtifactRarityValue,
} from "./enums";
