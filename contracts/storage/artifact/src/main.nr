// Storage contract for artifacts (id, discoverer, type, location, etc.).
// Only admin or authorized contracts can write; anyone can verify state by hash.
use ::aztec::macros::aztec;

#[aztec]
pub contract ArtifactStorage {
    use ::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, view},
            storage::storage,
        },
        protocol::{address::AztecAddress, hash::poseidon2_hash, traits::Serialize},
    };

    use ::aztec::state_vars::{Map, PublicMutable};
    use ::types::storage::artifact::Artifact;

    #[storage]
    struct Storage<Context> {
        // Admin and authorized callers (only they can write; read is public).
        admin: PublicMutable<AztecAddress, Context>,
        authorized_map: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
        authorized_index: Map<AztecAddress, PublicMutable<u32, Context>, Context>,
        authorized_list: Map<u32, PublicMutable<AztecAddress, Context>, Context>,
        authorized_count: PublicMutable<u32, Context>,
        // artifact id -> poseidon2 hash of Artifact
        state_roots: Map<Field, PublicMutable<Field, Context>, Context>,
    }

    #[event]
    struct ArtifactUpdate {
        id: Field,
        block_number: u32,
        state: Artifact,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
        self.storage.authorized_count.write(0);
    }

    // ================== INTERNAL AUTH ==================

    #[internal("public")]
    fn assert_admin() {
        assert(self.msg_sender() == self.storage.admin.read(), "Only admin");
    }

    #[internal("public")]
    fn assert_authorized() {
        let caller = self.msg_sender();
        let is_admin = caller == self.storage.admin.read();
        let is_authorized = self.storage.authorized_map.at(caller).read();
        assert((is_admin as u8) | (is_authorized as u8) != 0, "Not authorized");
    }

    // ================== ADD / UPDATE ==================

    #[external("public")]
    fn set(id: Field, state: Artifact) {
        self.internal.assert_authorized();
        let block_number = self.context.block_number();
        let root = poseidon2_hash(state.serialize());
        self.storage.state_roots.at(id).write(root);
        self.emit(ArtifactUpdate { id: id, block_number: block_number, state: state });
    }

    #[external("public")]
    fn set_spaceships_max5(ids: [Field; 5], states: [Artifact; 5], count: u32) {
        self.internal.assert_authorized();
        let block_number = self.context.block_number();
        for i in 0..5 {
            if i < count {
                let root = poseidon2_hash(states[i].serialize());
                self.storage.state_roots.at(ids[i]).write(root);
                self.emit(
                    ArtifactUpdate { id: ids[i], block_number: block_number, state: states[i] },
                );
            }
        }
    }

    // ================== ADMIN ==================

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

    /// Batch authorize up to 3 contracts in a single transaction.
    #[external("public")]
    fn add_authorized_contracts_batch(addresses: [AztecAddress; 3], count: u8) {
        self.internal.assert_admin();
        let mut current_count = self.storage.authorized_count.read();
        for i in 0..3 {
            if (i as u8) < count {
                let addr = addresses[i];
                assert(!self.storage.authorized_map.at(addr).read(), "Already authorized");
                self.storage.authorized_map.at(addr).write(true);
                self.storage.authorized_index.at(addr).write(current_count);
                self.storage.authorized_list.at(current_count).write(addr);
                current_count += 1;
            }
        }
        self.storage.authorized_count.write(current_count);
    }

    // ================== PUBLIC VIEWS ==================

    #[external("public")]
    #[view]
    fn verify(id: Field, state: Artifact) -> bool {
        let stored_hash = self.storage.state_roots.at(id).read();
        if stored_hash == 0 {
            state == Artifact::zero()
        } else {
            let computed_hash = poseidon2_hash(state.serialize());
            computed_hash == stored_hash
        }
    }

    #[external("public")]
    #[view]
    fn compute_state_hash(state: Artifact) -> Field {
        if (state == Artifact::zero()) {
            0
        } else {
            poseidon2_hash(state.serialize())
        }
    }

    #[external("public")]
    #[view]
    fn is_initialized(id: Field) -> bool {
        let stored_hash = self.storage.state_roots.at(id).read();
        stored_hash != 0
    }

    #[external("public")]
    #[view]
    fn get_state_root(id: Field) -> Field {
        self.storage.state_roots.at(id).read()
    }

    #[external("public")]
    #[view]
    fn verify_hash(id: Field, hash: Field) -> bool {
        let stored_hash = self.storage.state_roots.at(id).read();
        stored_hash == hash
    }

    #[external("public")]
    #[view]
    fn verify_hashes_batch(ids: [Field; 20], hashes: [Field; 20], count: u32) -> bool {
        let mut result = true;
        for i in 0..count {
            let stored_hash = self.storage.state_roots.at(ids[i]).read();
            if stored_hash != hashes[i] {
                result = false;
            }
        }
        result
    }

    // ================== UTILITY (UNCONSTRAINED) ==================

    #[external("utility")]
    unconstrained fn verify_unconstrained(id: Field, state: Artifact) -> bool {
        let stored_hash = self.storage.state_roots.at(id).read();
        if stored_hash == 0 {
            state == Artifact::zero()
        } else {
            let computed_hash = poseidon2_hash(state.serialize());
            computed_hash == stored_hash
        }
    }

    #[external("utility")]
    unconstrained fn compute_state_hash_unconstrained(state: Artifact) -> Field {
        if (state == Artifact::zero()) {
            0
        } else {
            poseidon2_hash(state.serialize())
        }
    }

    #[external("utility")]
    unconstrained fn get_state_root_unconstrained(id: Field) -> Field {
        self.storage.state_roots.at(id).read()
    }

    #[external("utility")]
    unconstrained fn get_default_state_unconstrained() -> Artifact {
        Artifact::zero()
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
        let is_admin: bool = addr == self.storage.admin.read();
        let is_authorized: bool = self.storage.authorized_map.at(addr).read();
        is_admin | is_authorized
    }

    #[external("utility")]
    unconstrained fn is_initialized_unconstrained(id: Field) -> bool {
        let stored_hash = self.storage.state_roots.at(id).read();
        stored_hash != 0
    }

    // ================== PUBLIC VIEWS (AUTH) ==================

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
        let is_admin: bool = addr == self.storage.admin.read();
        let is_authorized: bool = self.storage.authorized_map.at(addr).read();
        is_admin | is_authorized
    }
}
