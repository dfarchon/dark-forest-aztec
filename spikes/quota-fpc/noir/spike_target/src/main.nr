use aztec::macros::aztec;

/// Spike-only target contract. Its whole job is to record, publicly and
/// verifiably, the `msg_sender` it observed — that is the evidence spike 1B
/// needs (does the app see the PLAYER, or the FPC?). Also used by spike 1A as
/// a stand-in for a sponsored game call, including a revert path.
#[aztec]
contract SpikeTarget {
    use aztec::{
        macros::{functions::{external, only_self}, storage::storage},
        protocol::address::AztecAddress,
        state_vars::{Map, PublicMutable},
    };

    #[storage]
    struct Storage<Context> {
        /// caller-as-observed -> number of times it called us
        seen: Map<AztecAddress, PublicMutable<u32, Context>, Context>,
        last_caller: PublicMutable<AztecAddress, Context>,
    }

    /// Private entrypoint that forwards its observed msg_sender to public
    /// storage. `record` mirrors a real game call: private fn, enqueues a
    /// public call.
    #[external("private")]
    fn record() {
        let caller = self.context.maybe_msg_sender().unwrap();
        self.enqueue_self._record(caller);
    }

    #[external("public")]
    #[only_self]
    fn _record(caller: AztecAddress) {
        let n = self.storage.seen.at(caller).read();
        self.storage.seen.at(caller).write(n + 1);
        self.storage.last_caller.write(caller);
    }

    /// Reverts when called with 0 — used to prove what happens to quota side
    /// effects when the sponsored app call fails (spike 1A question a).
    /// Deliberately witness-dependent: `assert(false)` folds to a constant and
    /// barretenberg cannot derive a verification key for such a circuit.
    #[external("private")]
    fn revert_if_zero(x: Field) {
        assert(x != 0, "SpikeTarget: deliberate revert");
    }

    /// Purely private call (no public enqueue) — control case.
    #[external("private")]
    fn ping() {}

    #[external("utility")]
    unconstrained fn get_seen(caller: AztecAddress) -> u32 {
        self.storage.seen.at(caller).read()
    }

    #[external("utility")]
    unconstrained fn get_last_caller() -> AztecAddress {
        self.storage.last_caller.read()
    }
}
