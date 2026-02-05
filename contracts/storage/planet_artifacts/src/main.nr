use dep::aztec::macros::aztec;

/// PlanetArtifactsStorage - table for PlanetArtifacts per planet (mutable: add, update, read).
#[aztec]
pub contract PlanetArtifactsStorage {
    use dep::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, view},
            storage::storage,
        },
        protocol_types::{address::AztecAddress, hash::poseidon2_hash, traits::Packable},
    };
    use dep::aztec::state_vars::{Map, PublicMutable};
    use dep::types::{PlanetArtifacts, StateRoot};

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        state_roots: Map<Field, PublicMutable<StateRoot, Context>, Context>,
        authorized_map: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
        authorized_index: Map<AztecAddress, PublicMutable<u32, Context>, Context>,
        authorized_list: Map<u32, PublicMutable<AztecAddress, Context>, Context>,
        authorized_count: PublicMutable<u32, Context>,
    }

    #[event]
    struct PlanetArtifactsUpdated {
        id: Field,
        block_number: u32,
        state: PlanetArtifacts,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
        self.storage.authorized_count.write(0);
    }

    #[internal("public")]
    fn assert_admin() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
    }

    #[internal("public")]
    fn assert_authorized() {
        let caller = self.msg_sender().unwrap();
        let is_admin = caller == self.storage.admin.read();
        let is_authorized = self.storage.authorized_map.at(caller).read();
        assert(is_admin | is_authorized, "Not authorized");
    }

    #[external("public")]
    fn transfer_admin(new_admin: AztecAddress) {
        self.internal.assert_admin();
        self.storage.admin.write(new_admin);
    }

    #[external("public")]
    fn add_authorized_contract(contract_address: AztecAddress) {
        self.internal.assert_admin();
        assert(!self.storage.authorized_map.at(contract_address).read(), "Already authorized");

        let count = self.storage.authorized_count.read();
        self.storage.authorized_map.at(contract_address).write(true);
        self.storage.authorized_index.at(contract_address).write(count);
        self.storage.authorized_list.at(count).write(contract_address);
        self.storage.authorized_count.write(count + 1);
    }

    #[external("public")]
    fn remove_authorized_contract(contract_address: AztecAddress) {
        self.internal.assert_admin();
        assert(self.storage.authorized_map.at(contract_address).read(), "Not authorized");

        let index = self.storage.authorized_index.at(contract_address).read();
        let last_index = self.storage.authorized_count.read() - 1;

        self.storage.authorized_map.at(contract_address).write(false);

        if index != last_index {
            let last_contract = self.storage.authorized_list.at(last_index).read();
            self.storage.authorized_list.at(index).write(last_contract);
            self.storage.authorized_index.at(last_contract).write(index);
        }

        self.storage.authorized_list.at(last_index).write(AztecAddress::zero());
        self.storage.authorized_count.write(last_index);
    }

    #[external("public")]
    fn set(id: Field, state: PlanetArtifacts) {
        self.internal.assert_authorized();
        let block_number = self.context.block_number();
        let state_root = StateRoot::new(poseidon2_hash(state.pack()), block_number);
        self.storage.state_roots.at(id).write(state_root);
        self.emit(PlanetArtifactsUpdated { id: id, block_number: block_number, state: state });
    }

    #[external("public")]
    #[view]
    fn get_state_root(id: Field) -> StateRoot {
        self.storage.state_roots.at(id).read()
    }

    #[external("public")]
    #[view]
    fn verify(id: Field, state: PlanetArtifacts) -> bool {
        let state_root = self.storage.state_roots.at(id).read();
        let computed_hash = poseidon2_hash(state.pack());
        computed_hash == state_root.hash
    }

    #[external("public")]
    #[view]
    fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }

    #[external("public")]
    #[view]
    fn get_authorized_count() -> u32 {
        self.storage.authorized_count.read()
    }

    #[external("public")]
    #[view]
    fn get_authorized_contract(index: u32) -> AztecAddress {
        self.storage.authorized_list.at(index).read()
    }

    #[external("public")]
    #[view]
    fn is_authorized(addr: AztecAddress) -> bool {
        let is_admin = addr == self.storage.admin.read();
        let is_in_list = self.storage.authorized_map.at(addr).read();
        is_admin | is_in_list
    }

    #[external("public")]
    #[view]
    fn is_initialized(id: Field) -> bool {
        let state_root = self.storage.state_roots.at(id).read();
        state_root.hash != 0
    }

    #[external("utility")]
    unconstrained fn get_state_root_unconstrained(id: Field) -> StateRoot {
        self.storage.state_roots.at(id).read()
    }

    #[external("utility")]
    unconstrained fn compute_state_hash(state: PlanetArtifacts) -> Field {
        poseidon2_hash(state.pack())
    }

    #[external("utility")]
    unconstrained fn verify_unconstrained(id: Field, state: PlanetArtifacts) -> bool {
        let state_root = self.storage.state_roots.at(id).read();
        let computed_hash = poseidon2_hash(state.pack());
        computed_hash == state_root.hash
    }

    #[external("utility")]
    unconstrained fn get_admin_unconstrained() -> AztecAddress {
        self.storage.admin.read()
    }

    #[external("utility")]
    unconstrained fn get_authorized_count_unconstrained() -> u32 {
        self.storage.authorized_count.read()
    }

    #[external("utility")]
    unconstrained fn get_authorized_contract_unconstrained(index: u32) -> AztecAddress {
        self.storage.authorized_list.at(index).read()
    }

    #[external("utility")]
    unconstrained fn is_authorized_unconstrained(addr: AztecAddress) -> bool {
        let is_admin = addr == self.storage.admin.read();
        let is_in_list = self.storage.authorized_map.at(addr).read();
        is_admin | is_in_list
    }

    #[external("utility")]
    unconstrained fn is_initialized_unconstrained(id: Field) -> bool {
        let state_root = self.storage.state_roots.at(id).read();
        state_root.hash != 0
    }
}
