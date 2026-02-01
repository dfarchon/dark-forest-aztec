use dep::aztec::macros::aztec;

mod types;
mod hash_utils;

#[aztec]
pub contract Silver {
    use dep::aztec::{
        macros::{events::event, functions::external, storage::storage},
        protocol_types::address::AztecAddress,
    };
    use dep::aztec::state_vars::{Map, PublicMutable};
    use dep::config::Config;

    use crate::types::LargeData;

    #[storage]
    struct Storage<Context> {
        /// Store only hash (1 write) instead of full struct (100+ writes)
        data_hash_by_key: Map<Field, PublicMutable<Field, Context>, Context>,
    }

    #[event]
    struct LargeDataStored {
        key: Field,
        data: LargeData,
    }

    /// Store large data using hash + event pattern.
    /// - Computes poseidon2 hash of input struct (no input length limit)
    /// - Writes only 1 slot (hash) instead of 100+ slots
    /// - Emits full struct via event for off-chain indexing
    ///
    /// # Arguments
    /// - `key`: Identifier for this data slot (e.g. location_id, user_id)
    /// - `data`: The full struct to store (hash) and emit
    #[external("public")]
    fn store_large_data(key: Field, data: LargeData) {
        let mut fields: [Field; 100] = [0; 100];
        for i in 0..100 {
            fields[i] = data.values[i] as Field;
        }
        let computed_hash = crate::hash_utils::hash_large_fields(fields);
        self.storage.data_hash_by_key.at(key).write(computed_hash);

        for i in 0..10 {
            self.emit(LargeDataStored { key, data });
        }
    }

    /// Verify that passed data matches stored hash.
    #[external("public")]
    fn verify_large_data(key: Field, data: LargeData) -> pub bool {
        let stored_hash = self.storage.data_hash_by_key.at(key).read();
        let mut fields: [Field; 100] = [0; 100];
        for i in 0..100 {
            fields[i] = data.values[i] as Field;
        }
        let computed_hash = crate::hash_utils::hash_large_fields(fields);
        stored_hash == computed_hash
    }

    /// Read stored hash for a key (for testing).
    #[external("public")]
    fn get_data_hash(key: Field) -> pub Field {
        self.storage.data_hash_by_key.at(key).read()
    }

    /// Cross-contract call example: fetches admin address from config contract.
    #[external("public")]
    fn get_admin_from_config(config_address: AztecAddress) -> pub AztecAddress {
        self.call(Config::at(config_address).get_admin())
    }

    #[external("public")]
    fn get_msg_sender_from_config(config_address: AztecAddress) -> pub AztecAddress {
        self.call(Config::at(config_address).get_msg_sender())
    }
}
