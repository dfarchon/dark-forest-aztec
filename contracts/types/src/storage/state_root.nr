// StateRoot - generic hash + block_number wrapper
// Indexer uses block_number to quickly find the event containing full state

use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

#[derive(Serialize, Deserialize, Packable)]
pub struct StateRoot {
    pub hash: Field,
    pub block_number: u32,
}

impl StateRoot {
    pub fn zero() -> Self {
        StateRoot {
            hash: 0 as Field,
            block_number: 0,
        }
    }

    pub fn new(hash: Field, block_number: u32) -> Self {
        StateRoot { hash, block_number }
    }
}
