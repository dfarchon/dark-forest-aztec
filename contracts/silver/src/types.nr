use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

/// Large struct for PoC - writing this directly would exceed 63 write limit.
/// Uses array instead of named fields for scalability (500 fields).
#[derive(Serialize, Deserialize, Packable)]
pub struct LargeData {
    pub values: [u128; 500],
}
