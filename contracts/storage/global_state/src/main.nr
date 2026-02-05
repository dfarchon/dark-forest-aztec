use dep::aztec::macros::aztec;

/// GlobalStateStorage - manages game global state using a StateRoot pattern.
///
/// Storage model:
/// - On-chain: only StateRoot (hash + block_number) is stored.
/// - Off-chain: indexer syncs full state via GlobalStateUpdated events.
///
/// Authorization:
/// - Admin can manage authorized contracts and transfer admin.
/// - Authorized contracts (and admin) can call update to change state.
#[aztec]
pub contract GlobalStateStorage {
    use dep::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, view},
            storage::storage,
        },
        protocol_types::{address::AztecAddress, hash::poseidon2_hash, traits::Packable},
    };
    use dep::aztec::state_vars::{Map, PublicMutable};
    use dep::types::{GlobalState, StateRoot};

    #[storage]
    struct Storage<Context> {
        /// Admin address; has transfer_admin, add_authorized_contract, remove_authorized_contract.
        admin: PublicMutable<AztecAddress, Context>,
        /// Current state commitment: hash and block_number when written.
        state_root: PublicMutable<StateRoot, Context>,
        /// Address -> whether authorized; O(1) lookup.
        authorized_map: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
        /// Index of address in authorized_list; used for O(1) swap-remove.
        authorized_index: Map<AztecAddress, PublicMutable<u32, Context>, Context>,
        /// List of authorized addresses; indices 0..authorized_count-1 are valid.
        authorized_list: Map<u32, PublicMutable<AztecAddress, Context>, Context>,
        /// Number of authorized contracts.
        authorized_count: PublicMutable<u32, Context>,
    }

    #[event]
    /// Emitted when global state is updated; off-chain indexer syncs full GlobalState from this.
    struct GlobalStateUpdated {
        block_number: u32,
        state: GlobalState,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
        self.storage.state_root.write(StateRoot::zero());
        self.storage.authorized_count.write(0);
        self.internal.initialize();
    }

    /// One-time initialization of global state with default (GlobalState::zero()). Admin only when state_root is still zero.
    /// Emits GlobalStateUpdated so indexer gets the initial state.
    #[internal("public")]
    fn initialize() {
        self.internal.assert_admin();
        let root = self.storage.state_root.read();
        assert(root.hash == 0 as Field, "Already initialized");
        let initial_state = GlobalState::zero();
        let block_number = self.context.block_number();
        let hash = poseidon2_hash(initial_state.pack());
        self.storage.state_root.write(StateRoot::new(hash, block_number));
        self.emit(GlobalStateUpdated { block_number: block_number, state: initial_state });
    }

    // =====================================================================
    // INTERNAL - AUTH & STATE HELPERS
    // =====================================================================

    #[internal("public")]
    /// Reverts unless caller is admin.
    fn assert_admin() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
    }

    #[internal("public")]
    /// Reverts unless caller is admin or in authorized_map.
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
    /// Transfers admin to new_admin. Callable only by current admin.
    fn transfer_admin(new_admin: AztecAddress) {
        self.internal.assert_admin();
        self.storage.admin.write(new_admin);
    }

    #[external("public")]
    /// Adds contract to authorized list (allowed to call update). Admin only; reverts if already authorized.
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
    /// Removes contract from authorized list (swap-with-last then pop). Admin only; reverts if not authorized.
    fn remove_authorized_contract(contract_address: AztecAddress) {
        self.internal.assert_admin();
        assert(self.storage.authorized_map.at(contract_address).read(), "Not authorized");

        let index = self.storage.authorized_index.at(contract_address).read();
        let last_index = self.storage.authorized_count.read() - 1;

        self.storage.authorized_map.at(contract_address).write(false);

        // Swap with last if needed
        if index != last_index {
            let last_contract = self.storage.authorized_list.at(last_index).read();
            self.storage.authorized_list.at(index).write(last_contract);
            self.storage.authorized_index.at(last_contract).write(index);
        }

        self.storage.authorized_list.at(last_index).write(AztecAddress::zero());
        self.storage.authorized_count.write(last_index);
    }

    // =====================================================================
    // STATE WRITE - EXTERNAL (requires admin or authorized)
    // =====================================================================

    #[external("public")]
    fn update(new_state: GlobalState) {
        self.internal.assert_authorized();
        let block_number = self.context.block_number();
        let hash = poseidon2_hash(new_state.pack());
        self.storage.state_root.write(StateRoot::new(hash, block_number));
        self.emit(GlobalStateUpdated { block_number: block_number, state: new_state });
    }

    // =====================================================================
    // VIEWS - EXTERNAL (for cross-contract / public read)
    // =====================================================================

    #[external("public")]
    #[view]
    /// Returns current on-chain state_root (hash + block_number).
    fn get_state_root() -> StateRoot {
        self.storage.state_root.read()
    }

    #[external("public")]
    #[view]
    /// Returns true iff the given state hash matches current state_root.hash (for off-chain vs on-chain check).
    fn verify(state: GlobalState) -> bool {
        let stored_root = self.storage.state_root.read();
        let computed_hash = poseidon2_hash(state.pack());
        computed_hash == stored_root.hash
    }

    #[external("public")]
    #[view]
    fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }

    // =====================================================================
    // UTILITY - UNCONSTRAINED (off-chain read only)
    // =====================================================================

    #[external("utility")]
    /// Off-chain read of current state_root; unconstrained.
    unconstrained fn get_state_root_unconstrained() -> StateRoot {
        self.storage.state_root.read()
    }

    #[external("utility")]
    /// Off-chain Poseidon2 hash of GlobalState; unconstrained.
    unconstrained fn compute_state_hash(state: GlobalState) -> Field {
        poseidon2_hash(state.pack())
    }

    #[external("utility")]
    /// Off-chain read of current state; unconstrained.
    unconstrained fn verify_unconstrained(state: GlobalState) -> bool {
        let stored_root = self.storage.state_root.read();
        let computed_hash = poseidon2_hash(state.pack());
        computed_hash == stored_root.hash
    }

    #[external("utility")]
    /// Off-chain read of admin address; unconstrained.
    unconstrained fn get_admin_unconstrained() -> AztecAddress {
        self.storage.admin.read()
    }

    #[external("utility")]
    /// Off-chain read of authorized count; unconstrained.
    unconstrained fn get_authorized_count_unconstrained() -> u32 {
        self.storage.authorized_count.read()
    }

    #[external("utility")]
    /// Off-chain read of authorized contract at index; unconstrained.
    unconstrained fn get_authorized_contract_unconstrained(index: u32) -> AztecAddress {
        self.storage.authorized_list.at(index).read()
    }

    #[external("utility")]
    /// Off-chain check if address is in authorized_map (does not treat admin as authorized here); unconstrained.
    unconstrained fn is_authorized_unconstrained(addr: AztecAddress) -> bool {
        self.storage.authorized_map.at(addr).read()
    }
}
