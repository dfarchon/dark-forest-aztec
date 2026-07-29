use aztec::macros::aztec;

/// Test-only target for the QuotaFpc integration suite. Records the
/// `msg_sender` it observes, which is how the tests prove that a sponsored
/// call still authenticates as the user rather than the paymaster.
#[aztec]
contract FpcTestTarget {
    use aztec::{
        macros::{functions::{external, only_self}, storage::storage},
        protocol::address::AztecAddress,
        state_vars::{Map, PublicMutable},
    };

    #[storage]
    struct Storage<Context> {
        seen: Map<AztecAddress, PublicMutable<u32, Context>, Context>,
        last_caller: PublicMutable<AztecAddress, Context>,
        /// One-shot flag used to force an inclusion-time (public phase) revert.
        claimed: PublicMutable<bool, Context>,
    }

    /// Private call that forwards its observed caller to public state.
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

    /// Reverts when passed 0. Witness-dependent on purpose: `assert(false)`
    /// folds to a constant and no verification key can be derived for it.
    #[external("private")]
    fn revert_if_zero(x: Field) {
        assert(x != 0, "FpcTestTarget: deliberate revert");
    }

    /// Claims a one-shot flag. Simulates successfully for everyone while the
    /// flag is unset, but only the first transaction to land can succeed — the
    /// rest revert in the public phase, at INCLUSION time rather than during
    /// simulation. That is the failure mode real games produce under contention
    /// (ownership races, rate limits), and the one a sponsored transaction must
    /// survive correctly: included, fee paid, allowance consumed.
    #[external("private")]
    fn claim_once() {
        self.enqueue_self._claim_once();
    }

    #[external("public")]
    #[only_self]
    fn _claim_once() {
        assert(!self.storage.claimed.read(), "FpcTestTarget: already claimed");
        self.storage.claimed.write(true);
    }

    #[external("utility")]
    unconstrained fn is_claimed() -> bool {
        self.storage.claimed.read()
    }

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
