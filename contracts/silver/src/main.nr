use dep::aztec::macros::aztec;

#[aztec]
pub contract Silver {
    use dep::aztec::{macros::functions::external, protocol_types::address::AztecAddress};
    use dep::config::Config;

    /// Cross-contract call example: fetches admin address from config contract.
    /// config_address: The deployed address of the config contract.
    #[external("public")]
    fn get_admin_from_config(config_address: AztecAddress) -> pub AztecAddress {
        self.call(Config::at(config_address).get_admin())
    }

    #[external("public")]
    fn get_msg_sender_from_config(config_address: AztecAddress) -> pub AztecAddress {
        self.call(Config::at(config_address).get_msg_sender())
    }
}
