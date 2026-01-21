use dep::aztec::macros::aztec;

#[aztec]
pub contract Main {
    use dep::aztec::{
        macros::{events::event, functions::{external, initializer}, storage::storage},
        protocol_types::{address::AztecAddress, traits::{Deserialize, Packable, Serialize}},
    };
    use dep::aztec::state_vars::{Map, PublicMutable};
    use dep::std::meta::derive;


    // ========== Storage Structure ==========
    // Full storage structure
    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
     
    }

    // ========== Constructor ==========
    // Initializes all storage with configuration constants
    // Note: We pass the admin address explicitly from the deploy script,
    // instead of relying on msg_sender during contract deployment.
    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
    }

    // ========== Storage Access Functions ==========
    // Essential getter functions for accessing contract storage

    #[external("utility")]
    unconstrained fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }
      
}