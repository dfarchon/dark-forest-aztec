use dep::aztec::macros::aztec;

#[aztec]
pub contract Config {
    use dep::aztec::{
        macros::{functions::{external, initializer}, storage::storage},
        protocol_types::address::AztecAddress,
    };
    use dep::aztec::state_vars::PublicMutable;

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
    }

    /// Returns the admin address. Can be called by other contracts for cross-contract reads.
    #[external("public")]
    fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }

    #[external("utility")]
    unconstrained fn get_admin_unconstrained() -> AztecAddress {
        self.storage.admin.read()
    }

    #[external("public")]
    fn get_msg_sender() -> AztecAddress {
        self.msg_sender().unwrap()
    }
}
