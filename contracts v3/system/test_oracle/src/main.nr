use dep::aztec::macros::aztec;

#[aztec]
contract TestOracle {
    use dep::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, only_self, view},
            storage::storage,
        },
        oracle::block_header::get_block_header_at,
        protocol_types::traits::Hash,
        state_vars::PublicMutable,
    };

    // ---- Storage ----

    #[storage]
    struct Storage<Context> {
        // Stores the last block hash retrieved by a private call.
        last_block_hash: PublicMutable<Field, Context>,
        // Stores the block number that was queried last.
        last_queried_block: PublicMutable<u32, Context>,
    }

    // ---- Events ----

    /// Emitted (publicly) when test_get_block_header_private succeeds.
    /// Visible to off-chain scripts via getDecodedPublicEvents.
    #[event]
    struct BlockHashResult {
        target_block: u32,
        block_hash: Field,
        chain_id: Field,
    }

    // ---- Constructor ----

    #[external("public")]
    #[initializer]
    fn constructor() {
        self.storage.last_block_hash.write(0);
        self.storage.last_queried_block.write(0);
    }

    // ---- Private entry ----

    /// Private function: fetches block header at `target_block` using the oracle,
    /// hashes it, then enqueues a public write + event emission.
    #[external("private")]
    fn test_get_block_header_private(target_block: u32) {
        let header = get_block_header_at(target_block, *self.context);
        let block_hash = header.hash();
        let chain_id = self.context.chain_id();
        self.enqueue_self.record_block_hash_public(target_block, block_hash, chain_id);
    }

    // ---- Public (only_self) writer ----

    /// Called only via enqueue_self from test_get_block_header_private.
    /// Stores the result and emits a public event so off-chain tools can observe it.
    #[external("public")]
    #[only_self]
    fn record_block_hash_public(target_block: u32, block_hash: Field, chain_id: Field) {
        self.storage.last_block_hash.write(block_hash);
        self.storage.last_queried_block.write(target_block);
        self.emit(BlockHashResult { target_block, block_hash, chain_id });
    }

    // ---- Public views ----

    /// Returns the most recently stored block hash.
    #[external("public")]
    #[view]
    fn get_last_block_hash() -> Field {
        self.storage.last_block_hash.read()
    }

    /// Returns the block number that was last queried.
    #[external("public")]
    #[view]
    fn get_last_queried_block() -> u32 {
        self.storage.last_queried_block.read()
    }

    // ---- chain_id utility ----

    #[external("public")]
    #[view]
    fn get_chain_id() -> Field {
        self.context.chain_id()
    }
}
