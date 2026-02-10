use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

/// Large struct for PoC - writing this directly would exceed 63 write limit.
/// Uses array instead of named fields for scalability (500 fields).
#[derive(Serialize, Deserialize, Packable)]
pub struct LargeData {
    pub values: [u128; 500],
}

/// One chunk of 40 Fields (20000 total = 500 chunks -> 500 hashes to public).
#[derive(Serialize, Deserialize, Packable)]
pub struct Chunk40 {
    pub values: [Field; 40],
}

/// Large private input: 20000 Fields as 500 chunks of 40; emit 500 chunk hashes to public.
#[derive(Serialize, Deserialize, Packable)]
pub struct LargePrivateInput {
    pub chunks: [Chunk40; 500],
}
