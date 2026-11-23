const ARTIFACT_TYPES: Record<number, string> = {
  0: "Unknown",
  1: "Monolith",
  2: "Colossus",
  3: "Spaceship",
  4: "Pyramid",
  5: "Wormhole",
  6: "Planetary Shield",
  7: "Photoid Cannon",
  8: "Bloom Filter",
  9: "Black Domain",
  10: "Mothership",
  11: "Crescent",
  12: "Whale",
  13: "Gear",
  14: "Titan",
};

const RARITIES: Record<number, string> = {
  0: "Unknown",
  1: "Common",
  2: "Rare",
  3: "Epic",
  4: "Legendary",
  5: "Mythic",
};

export const RARITY_COLORS: Record<number, string> = {
  0: "#838383",
  1: "#838383",
  2: "#6b68ff",
  3: "#c13cff",
  4: "#f8b73e",
  5: "#ff44b7",
};

export function actionLabel(action: string): string {
  return action
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function artifactLabel(artifactType: number, rarity: number): string {
  const type = ARTIFACT_TYPES[artifactType] ?? `Type ${artifactType}`;
  const name = RARITIES[rarity] ?? `Rarity ${rarity}`;
  return `${type} · ${name}`;
}
