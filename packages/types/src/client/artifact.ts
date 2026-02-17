import type { Artifact, ArtifactType, ArtifactRarity } from "../world/artifact";
import type { Biome } from "../world/game_types";
import type { ArtifactId } from "../identifiers";
import type { TransactionCollection } from "../tx/transaction";

export interface RenderedArtifact extends Partial<Artifact> {
  artifactType: ArtifactType;
  planetBiome: Biome;
  rarity: ArtifactRarity;
  id: ArtifactId;
  transactions?: TransactionCollection;
}

export type NFTAttribute = {
  trait_type: string;
  value: string | number;
  display_type?: string;
};

export type NFTMetadata = {
  name: string;
  description: string;
  image: string;
  attributes: NFTAttribute[];
};
