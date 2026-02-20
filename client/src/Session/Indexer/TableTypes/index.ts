/**
 * Frontend chain state types. Re-exports from chain and enums.
 * Use: import { PlanetState, PlanetType } from '@/types' or from './types'
 */

// Chain state types and entity types
export type {
  AddressString,
  ArrivalEntity,
  ArrivalState,
  ArtifactEntity,
  ArtifactLocationEntity,
  ArtifactLocationState,
  ArtifactState,
  FieldId,
  PlanetArtifactsEntity,
  PlanetArtifactsState,
  PlanetEntity,
  PlanetEventMetadata,
  PlanetEventsEntity,
  PlanetEventsState,
  PlanetRevealedCoordsEntity,
  PlanetRevealedCoordsState,
  PlanetState,
  PlayerEntity,
  PlayerState,
  WorldEntity,
  WorldState,
} from "./chain";

// Enum constants and name maps (values match contracts/types storage mods)
export type {
  ArrivalTypeValue,
  ArtifactRarityValue,
  ArtifactTypeValue,
  BiomeValue,
  PlanetEventTypeValue,
  PlanetTypeValue,
  SpaceTypeValue,
  UpgradeBranchValue,
} from "./enums";
export {
  ArrivalType,
  ArrivalTypeName,
  ArtifactRarity,
  ArtifactRarityName,
  ArtifactType,
  ArtifactTypeName,
  Biome,
  BiomeName,
  PlanetEventType,
  PlanetEventTypeName,
  PlanetType,
  PlanetTypeName,
  SpaceType,
  SpaceTypeName,
  UpgradeBranch,
  UpgradeBranchName,
} from "./enums";
