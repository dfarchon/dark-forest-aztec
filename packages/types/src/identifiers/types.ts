/**
 * An abstract type used to differentiate between common types, like `number` or `string`.
 * The `Token` type parameter is the key to vary upon and should be unique unless being used to subtype.
 */
export type Abstract<T, K> = T & { readonly __brand: K };

/**
 * A voyage UID. These start at 1 and auto-increment in the contract. This is
 * immutable and the only place a VoyageId should ever be created is on
 * initial deserialization of a QueuedArrival from contract data (see `serde`).
 */
export type VoyageId = Abstract<string, "VoyageId">;

/**
 * A unique identifier for a location in the universe (corresponding to some
 * underlying coordinates (x, y)). This is a 64-character lowercase hex string
 * not prefixed with 0x. LocationIDs should only be instantiated through
 * `locationIdFromHexStr`, `locationIdFromDecStr`, `locationIdFromBigInt`, and
 * `locationIdFromEthersBN` in `serde`.
 */
export type LocationId = Abstract<string, "LocationId">;

/**
 * Address type for compatibility with the previous client (EthAddress).
 * Expected to be a 32-byte value represented as a 0x-prefixed lowercase hex
 * string (64 hex chars, 66 chars total). On Aztec this aligns with
 * AztecAddress.toHexString(); create/validate via AztecAddress.fromString /
 * toHexString in application code. This package only defines the branded type.
 */
export type EthAddress = Abstract<string, "EthAddress">;

/**
 * A unique identifier for a Dark Forest NFT artifact. This is a 64-character
 * lowercase hex string not prefixed with 0x. ArtifactIDs should only be
 * instantiated through `artifactIdFromHexStr`, `artifactIdFromDecStr`, and
 * `artifactIdFromEthersBN` in `serde`.
 */
export type ArtifactId = Abstract<string, "ArtifactId">;
