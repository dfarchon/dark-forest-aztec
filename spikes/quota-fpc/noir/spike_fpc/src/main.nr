use aztec::macros::aztec;

/// Spike 1A: the standard sibling-call quota FPC, as specified in
/// implementations-plan/quota-fpc/plan.md. Called by the player's account
/// entrypoint via the fee payload, so `msg_sender` inside is the PLAYER.
///
/// Differences from aztec-kit's SubscriptionFPC (all audit-driven, see plan):
///  - no admin / no sign_up: policy is a constructor immutable
///  - generation = UTC day index validated against the anchor block timestamp
///  - a PLAYER nullifier as well as a SEAT nullifier (one subscription/player/day)
///  - remaining-based notes inserted BEFORE end_setup (non-revertible), and
///    no zero-remaining notes are ever created (no max_uses+1 off-by-one)
#[aztec]
contract SpikeFpc {
    use aztec::{
        macros::{
            functions::{allow_phase_change, external, initializer},
            notes::note,
            storage::storage,
        },
        messages::delivery::MessageDelivery,
        note::{
            note_getter_options::NoteGetterOptions, note_interface::NoteProperties,
            note_viewer_options::NoteViewerOptions,
        },
        protocol::{
            abis::gas_settings::GasSettings,
            address::AztecAddress,
            hash::poseidon2_hash_with_separator,
            traits::{Deserialize, Packable, Serialize, ToField},
        },
        state_vars::{Owned, PrivateSet, PublicImmutable},
        utils::comparison::Comparator,
    };

    global SEAT_NULLIFIER_SEPARATOR: u32 = 1397047636; // "SEAT"
    global PLAYER_NULLIFIER_SEPARATOR: u32 = 1347240786; // "PLYR"
    global SECONDS_PER_DAY: u64 = 86400;
    /// Grace window at the end of a day during which tomorrow's generation is
    /// already accepted (proving+inclusion latency across midnight).
    global ROLLOVER_GRACE_SECONDS: u64 = 600;

    #[derive(Deserialize, Eq, Packable, Serialize)]
    pub struct Policy {
        max_fee: u128,
        max_uses: u32,
        max_users: u32,
    }

    #[derive(Packable, Eq)]
    #[note]
    struct QuotaNote {
        remaining: u32,
        generation: u32,
    }

    #[storage]
    struct Storage<Context> {
        policy: PublicImmutable<Policy, Context>,
        quotas: Owned<PrivateSet<QuotaNote, Context>, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(max_fee: u128, max_uses: u32, max_users: u32) {
        // Constructor invariants (codex final-pass condition): the reference
        // guarded these in sign_up, which this design deletes.
        assert(max_uses > 0, "max_uses must be greater than zero");
        assert(max_users > 0, "max_users must be greater than zero");
        assert(max_fee > 0, "max_fee must be greater than zero");
        self.storage.policy.initialize(Policy { max_fee, max_uses, max_users });
    }

    #[contract_library_method]
    fn assert_fee_within_max(gas_settings: GasSettings, max_fee: u128) {
        let total_gas = gas_settings.gas_limits + gas_settings.teardown_gas_limits;
        let max_possible_fee: u128 = (total_gas.da_gas as u128)
            * gas_settings.max_fees_per_gas.fee_per_da_gas
            + (total_gas.l2_gas as u128) * gas_settings.max_fees_per_gas.fee_per_l2_gas;
        assert(max_possible_fee <= max_fee, "Gas settings exceed policy max_fee");
    }

    #[contract_library_method]
    fn compute_seat_nullifier_inner(generation: u32, seat: u32) -> Field {
        poseidon2_hash_with_separator(
            [generation as Field, seat as Field],
            SEAT_NULLIFIER_SEPARATOR,
        )
    }

    #[contract_library_method]
    fn compute_player_nullifier_inner(generation: u32, player: AztecAddress) -> Field {
        poseidon2_hash_with_separator(
            [generation as Field, player.to_field()],
            PLAYER_NULLIFIER_SEPARATOR,
        )
    }

    /// Generation validity, judged purely against the anchor block timestamp.
    /// Accepts today, plus tomorrow only inside the final ROLLOVER_GRACE_SECONDS
    /// of today (shrinks the pre-squat window; the protocol independently caps
    /// inclusion at anchor+24h).
    #[contract_library_method]
    fn assert_generation_fresh(anchor_timestamp: u64, generation: u32) {
        let today = anchor_timestamp / SECONDS_PER_DAY;
        let generation_u64 = generation as u64;
        let seconds_into_day = anchor_timestamp % SECONDS_PER_DAY;
        let in_grace_window = seconds_into_day >= (SECONDS_PER_DAY - ROLLOVER_GRACE_SECONDS);
        let valid = (generation_u64 == today)
            | ((generation_u64 == today + 1) & in_grace_window);
        assert(valid, "Generation is not currently sponsorable");
    }

    /// First sponsored tx of the player's day.
    #[external("private")]
    #[allow_phase_change]
    fn subscribe(generation: u32, seat: u32) {
        let player = self.context.maybe_msg_sender().unwrap();
        let policy = self.storage.policy.read();

        assert_generation_fresh(self.context.get_anchor_block_header().timestamp(), generation);
        assert(seat < policy.max_users, "Seat out of range");

        // One subscription per player per generation.
        self.context.push_nullifier_unsafe(compute_player_nullifier_inner(generation, player));
        // Daily capacity: at most max_users distinct seats can ever exist.
        self.context.push_nullifier_unsafe(compute_seat_nullifier_inner(generation, seat));

        assert_fee_within_max(self.context.gas_settings(), policy.max_fee);

        // Insert BEFORE end_setup so an app-call revert cannot destroy the
        // player's quota note while the seat nullifier stands.
        if policy.max_uses >= 2 {
            self
                .storage
                .quotas
                .at(player)
                .insert(QuotaNote { remaining: policy.max_uses - 1, generation })
                .deliver(MessageDelivery::onchain_unconstrained().with_sender(player));
        }

        self.context.set_as_fee_payer();
        self.context.end_setup();
    }

    /// Subsequent sponsored txs.
    #[external("private")]
    #[allow_phase_change]
    fn sponsor(generation: u32) {
        let player = self.context.maybe_msg_sender().unwrap();
        let policy = self.storage.policy.read();

        assert_generation_fresh(self.context.get_anchor_block_header().timestamp(), generation);

        let options = NoteGetterOptions::new().set_limit(1).select(
            QuotaNote::properties().generation,
            Comparator.EQ,
            generation,
        );
        let notes = self.storage.quotas.at(player).pop_notes(options);
        assert(notes.len() > 0, "No sponsored transactions remaining");
        let quota = notes.get(0);

        assert_fee_within_max(self.context.gas_settings(), policy.max_fee);

        if quota.remaining >= 2 {
            self
                .storage
                .quotas
                .at(player)
                .insert(QuotaNote { remaining: quota.remaining - 1, generation })
                .deliver(MessageDelivery::onchain_unconstrained().with_sender(player));
        }

        self.context.set_as_fee_payer();
        self.context.end_setup();
    }

    #[external("utility")]
    unconstrained fn get_quota_info(player: AztecAddress, generation: u32) -> (bool, u32) {
        let options = NoteViewerOptions::new().set_limit(1).select(
            QuotaNote::properties().generation,
            Comparator.EQ,
            generation,
        );
        let notes = self.storage.quotas.at(player).view_notes(options);
        if notes.len() == 0 {
            (false, 0)
        } else {
            (true, notes.get(0).remaining)
        }
    }

    #[external("utility")]
    unconstrained fn get_policy() -> Policy {
        self.storage.policy.read()
    }

    #[external("utility")]
    unconstrained fn compute_seat_nullifier(generation: u32, seat: u32) -> Field {
        compute_seat_nullifier_inner(generation, seat)
    }

    #[external("utility")]
    unconstrained fn compute_player_nullifier(generation: u32, player: AztecAddress) -> Field {
        compute_player_nullifier_inner(generation, player)
    }
}
