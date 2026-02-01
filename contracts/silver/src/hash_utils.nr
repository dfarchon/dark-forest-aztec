//! Hash utilities for large structs.
//! poseidon2_hash has no input length limit - can directly hash [Field; 100].

use dep::aztec::protocol_types::hash::poseidon2_hash;

/// Hash a large array of 100 fields using poseidon2.
/// poseidon2 uses sponge construction - no input length limit.
pub fn hash_large_fields(fields: [Field; 100]) -> Field {
    poseidon2_hash(fields)
}
