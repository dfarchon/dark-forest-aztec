use dep::aztec::macros::aztec;

/// ArrivalStorage - append-only table for arrival data (planet events).
///
/// Storage model:
/// - On-chain: one StateRoot per id (hash + block_number), and next_id. Append-only: no updates.
/// - Off-chain: indexer syncs full history via ArrivalUpdated events.
///
/// Authorization:
/// - Admin can manage authorized contracts and transfer admin.
/// - Authorized contracts (and admin) can call append only. No modify/delete.
#[aztec]
pub contract ArrivalStorage {
    use dep::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, view},
            storage::storage,
        },
        protocol_types::{address::AztecAddress, hash::poseidon2_hash, traits::Packable},
    };
    use dep::aztec::state_vars::{Map, PublicMutable};
    use dep::types::{Arrival, StateRoot};

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        next_id: PublicMutable<u128, Context>,
        state_roots: Map<u128, PublicMutable<StateRoot, Context>, Context>,
        authorized_map: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
        authorized_index: Map<AztecAddress, PublicMutable<u32, Context>, Context>,
        authorized_list: Map<u32, PublicMutable<AztecAddress, Context>, Context>,
        authorized_count: PublicMutable<u32, Context>,
    }

    #[event]
    /// Emitted on append; contains id, block_number, and full Arrival (append-only, never updated).
    struct ArrivalUpdated {
        id: u128,
        block_number: u32,
        arrival: Arrival,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
        self.storage.next_id.write(1);
        self.storage.authorized_count.write(0);
    }

    // =====================================================================
    // INTERNAL - AUTH HELPERS
    // =====================================================================

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

    // =====================================================================
    // ADMIN - EXTERNAL
    // =====================================================================

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

    // =====================================================================
    // APPEND ONLY - EXTERNAL (requires admin or authorized; no update/delete)
    // =====================================================================

    /// Appends one arrival record. Assigns next id, writes state_root, emits event. Ids are immutable; no update or delete.
    #[external("public")]
    fn append(arrival: Arrival) -> u128 {
        self.internal.assert_authorized();
        let block_number = self.context.block_number();
        let state_root = StateRoot::new(poseidon2_hash(arrival.pack()), block_number);
        let id = self.storage.next_id.read();
        self.storage.state_roots.at(id).write(state_root);
        self.storage.next_id.write(id + 1);
        self.emit(ArrivalUpdated { id: id, block_number: block_number, arrival: arrival });
        id
    }

    // =====================================================================
    // VIEWS - EXTERNAL
    // =====================================================================

    #[external("public")]
    #[view]
    fn get_state_root(id: u128) -> StateRoot {
        self.storage.state_roots.at(id).read()
    }

    #[external("public")]
    #[view]
    fn verify(id: u128, arrival: Arrival) -> bool {
        let state_root = self.storage.state_roots.at(id).read();
        let computed_hash = poseidon2_hash(arrival.pack());
        computed_hash == state_root.hash
    }

    #[external("public")]
    #[view]
    fn get_next_id() -> u128 {
        self.storage.next_id.read()
    }

    #[external("public")]
    #[view]
    fn is_initialized(id: u128) -> bool {
        let state_root = self.storage.state_roots.at(id).read();
        state_root.hash != 0
    }

    // =====================================================================
    // UTILITY - UNCONSTRAINED
    // =====================================================================

    #[external("utility")]
    unconstrained fn get_state_root_unconstrained(id: u128) -> StateRoot {
        self.storage.state_roots.at(id).read()
    }

    #[external("utility")]
    unconstrained fn compute_state_hash(arrival: Arrival) -> Field {
        poseidon2_hash(arrival.pack())
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
    unconstrained fn is_initialized_unconstrained(id: u128) -> bool {
        let state_root = self.storage.state_roots.at(id).read();
        state_root.hash != 0
    }
}
