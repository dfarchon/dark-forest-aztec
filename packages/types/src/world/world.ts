import type { LocationId } from "../identifiers";

/**
 * Represents the coordinates of a location in the world.
 */
export type WorldCoords = {
  x: number;
  y: number;
};

/**
 * A location in the world with relevant properties: the location's ID
 * (deterministically generated from its coords), the spacetype perlin value at
 * these coordinates, and the biomebase perlin value at these coordinates
 * (combined with spacetype to derive the biome here)
 */
export type WorldLocation = {
  coords: WorldCoords;
  hash: LocationId;
  perlin: number;
  biomebase: number;
};

/**
 * Ok, this is gonna sound weird, but all rectangles are squares. Also, we only permit side lengths
 * that are powers of two, and ALSO!! The side lengths must be between MIN_CHUNK_SIZE and MAX_CHUNK_SIZE.
 */
export interface Rectangle {
  bottomLeft: WorldCoords;
  sideLength: number;
}

/**
 * Represents a fully mined aligned square.
 */
export interface Chunk {
  chunkFootprint: Rectangle;
  planetLocations: WorldLocation[];
  perlin: number;
}

/**
 * Various configuration used for calculating perlin.
 * Always make sure these values match the contracts you are working with
 * or else your transactions **will** be reverted.
 */
export interface PerlinConfig {
  key: number;
  scale: number;
  mirrorX: boolean;
  mirrorY: boolean;
  floor: boolean;
}
