use aztec::macros::aztec;

/// QuotaFpc — a reusable, app-agnostic fee-paying contract (paymaster).
///
/// Sponsors each user's transactions up to a per-user daily allowance, and only
/// for transactions that target an allowlisted set of application contracts.
/// Nothing here is specific to any one application: the allowlist and the
/// policy are constructor arguments, supplied from a config file. Forking this
/// for another app means editing that config — not this contract.
///
/// SHAPE ("sandwich"): this contract is the TRANSACTION ORIGIN. It binds the
/// user-signed payload to the allowlist, does quota bookkeeping, elects itself
/// fee payer, ends the setup phase, and then invokes the USER'S OWN ACCOUNT
/// ENTRYPOINT with that payload. The sponsored application therefore still
/// observes the user as `msg_sender`, so `msg_sender`-based ownership checks
/// keep working and the sponsored contracts need no changes and no redeploy.
///
/// Design decisions:
///  - No admin, no setters: the policy is fixed at construction. Nothing is
///    privileged post-deploy, so there is no key worth stealing. Retuning the
///    policy means deploying a new instance (fund in tranches accordingly).
///  - Generations are UTC day indices validated against the anchor block
///    timestamp, so the daily reset needs no cron and no operator action.
///  - One subscription per user per generation (player nullifier) and at most
///    `max_users` users per generation (seat nullifiers).
///  - Quota notes are written BEFORE `end_setup` so an app-call revert can never
///    strand a user who has already burned a seat.
///  - `max_fee` is asserted in private setup, so a transaction that would cost
///    the contract more than the allowance cannot even be proven.
///
/// Fee juice sent here is unrecoverable: there is no withdraw (the protocol
/// makes fee juice non-transferable) and no pause. Fund in tranches.
#[aztec]
contract QuotaFpc {
    use aztec::{
        authwit::entrypoint::FunctionCall,
        context::PrivateContext,
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
            abis::{function_selector::FunctionSelector, gas_settings::GasSettings},
            address::AztecAddress,
            hash::poseidon2_hash_with_separator,
            traits::{Deserialize, Packable, Serialize, ToField},
        },
        state_vars::{Owned, PrivateSet, PublicImmutable},
        utils::comparison::Comparator,
    };

    /// Matches `ACCOUNT_MAX_CALLS` in aztec-nr's `AppPayload`. Dark Forest sends
    /// exactly one call per transaction (TxExecutor resolves an intent to a
    /// single contract method; nothing in the client batches), so four slots
    /// stay spare — the ceiling is not a constraint for this app.
    global ACCOUNT_MAX_CALLS: u32 = 5;
    /// Allowlist capacity. Sized with headroom because the allowlist is
    /// immutable — growing it means deploying a new instance. Zero entries are
    /// ignored, so an app with fewer targets simply pads the array.
    /// (Reference deployment: Dark Forest sponsors six player-facing contracts
    /// and deliberately excludes its Admin and Config contracts.)
    global MAX_ALLOWED_TARGETS: u32 = 12;

    global SEAT_NULLIFIER_SEPARATOR: u32 = 1397047636; // "SEAT" (0x53454154)
    global PLAYER_NULLIFIER_SEPARATOR: u32 = 1347180882; // "PLYR" (0x504c5952)

    global SECONDS_PER_DAY: u64 = 86400;
    /// Tomorrow's generation is accepted only inside this window at the end of a
    /// day, so a transaction proven just before midnight can still land after it.
    /// Kept short to shrink the window in which tomorrow's seats can be claimed.
    global ROLLOVER_GRACE_SECONDS: u64 = 600;
    /// Upper bound placed on the transaction's own lifetime, so a stale anchor
    /// cannot be used to reach back into an older generation.
    global EXPIRATION_SLACK_SECONDS: u64 = 3600;

    /// `AccountFeePaymentMethodOptions.EXTERNAL`: tells the account contract that
    /// another contract pays, so it must not touch the fee payer or setup phase.
    global FEE_PAYMENT_EXTERNAL: u8 = 0;

    /// Layout-identical mirror of `aztec::authwit::entrypoint::app::AppPayload`,
    /// whose `function_calls` field is private and therefore not iterable from
    /// here. Serialization MUST stay identical: 5 x FunctionCall (6 fields each)
    /// followed by `tx_nonce`. That is what the player signed and what the
    /// account contract deserializes.
    #[derive(Deserialize, Serialize)]
    pub struct QuotaPayload {
        function_calls: [FunctionCall; ACCOUNT_MAX_CALLS],
        pub tx_nonce: Field,
    }

    #[derive(Deserialize, Eq, Packable, Serialize)]
    pub struct Policy {
        /// Ceiling on what this contract will pay for any single transaction.
        max_fee: u128,
        /// Sponsored transactions per player per generation.
        max_uses: u32,
        /// Distinct players per generation.
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
        allowed_targets: PublicImmutable<[AztecAddress; MAX_ALLOWED_TARGETS], Context>,
        quotas: Owned<PrivateSet<QuotaNote, Context>, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(
        max_fee: u128,
        max_uses: u32,
        max_users: u32,
        allowed_targets: [AztecAddress; MAX_ALLOWED_TARGETS],
    ) {
        assert(max_fee > 0, "max_fee must be greater than zero");
        assert(max_uses > 0, "max_uses must be greater than zero");
        assert(max_users > 0, "max_users must be greater than zero");

        let mut any_target = false;
        for target in allowed_targets {
            if !target.is_zero() {
                any_target = true;
            }
        }
        assert(any_target, "at least one allowed target is required");

        self.storage.policy.initialize(Policy { max_fee, max_uses, max_users });
        self.storage.allowed_targets.initialize(allowed_targets);
    }

    // ------------------------------------------------------------------
    // Library methods
    // ------------------------------------------------------------------

    /// Bounds the maximum fee this transaction could possibly cost the contract.
    /// Asserted during private setup: a transaction whose gas settings exceed
    /// the allowance cannot be proven, so it can never reach a sequencer and
    /// leave the contract liable for more than `max_fee`.
    #[contract_library_method]
    fn assert_fee_within_max(gas_settings: GasSettings, max_fee: u128) {
        let total_gas = gas_settings.gas_limits + gas_settings.teardown_gas_limits;
        let max_possible_fee: u128 = (total_gas.da_gas as u128)
            * gas_settings.max_fees_per_gas.fee_per_da_gas
            + (total_gas.l2_gas as u128) * gas_settings.max_fees_per_gas.fee_per_l2_gas;
        assert(max_possible_fee <= max_fee, "Gas settings exceed the sponsorship allowance");
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

    /// Accepts the anchor block's own day, plus the next day only within the
    /// closing grace window. The protocol independently requires inclusion
    /// within 24h of the anchor, so this bounds how far sponsorship can reach.
    #[contract_library_method]
    fn assert_generation_fresh(anchor_timestamp: u64, generation: u32) {
        let today = anchor_timestamp / SECONDS_PER_DAY;
        let seconds_into_day = anchor_timestamp % SECONDS_PER_DAY;
        let in_grace_window = seconds_into_day >= (SECONDS_PER_DAY - ROLLOVER_GRACE_SECONDS);
        let generation_u64 = generation as u64;
        let valid = (generation_u64 == today) | ((generation_u64 == today + 1) & in_grace_window);
        assert(valid, "Generation is not currently sponsorable");
    }

    // ------------------------------------------------------------------
    // Entrypoints
    // ------------------------------------------------------------------

    /// A player's first sponsored transaction of the day: claims a seat, opens a
    /// quota note, then executes the payload through the player's account.
    #[external("private")]
    #[allow_phase_change]
    fn subscribe_and_execute(
        app_payload: QuotaPayload,
        player: AztecAddress,
        generation: u32,
        seat: u32,
    ) {
        begin_sponsorship(
            self.context,
            app_payload,
            self.storage.allowed_targets.read(),
            generation,
        );
        let policy = self.storage.policy.read();

        assert(seat < policy.max_users, "No sponsorship seats available today");
        // One subscription per player per generation.
        self.context.push_nullifier_unsafe(compute_player_nullifier_inner(generation, player));
        // Daily capacity: at most `max_users` seats can ever exist per generation.
        self.context.push_nullifier_unsafe(compute_seat_nullifier_inner(generation, seat));

        // Written before `end_setup` (below) so it is non-revertible: an app-call
        // revert must never consume a seat while losing the player's allowance.
        if policy.max_uses >= 2 {
            self
                .storage
                .quotas
                .at(player)
                .insert(QuotaNote { remaining: policy.max_uses - 1, generation })
                .deliver(MessageDelivery::onchain_unconstrained().with_sender(player));
        }

        sponsor_and_hand_off(self.context, app_payload, player, policy.max_fee);
    }

    /// A player's subsequent sponsored transactions of the day.
    #[external("private")]
    #[allow_phase_change]
    fn sponsor_and_execute(app_payload: QuotaPayload, player: AztecAddress, generation: u32) {
        begin_sponsorship(
            self.context,
            app_payload,
            self.storage.allowed_targets.read(),
            generation,
        );
        let policy = self.storage.policy.read();

        let options = NoteGetterOptions::new().set_limit(1).select(
            QuotaNote::properties().generation,
            Comparator.EQ,
            generation,
        );
        let notes = self.storage.quotas.at(player).pop_notes(options);
        assert(notes.len() > 0, "No sponsored transactions remaining");
        let quota = notes.get(0);

        // Exhausted notes are never re-inserted, so the allowance is exactly
        // `max_uses` transactions — the note's absence IS the exhaustion signal.
        if quota.remaining >= 2 {
            self
                .storage
                .quotas
                .at(player)
                .insert(QuotaNote { remaining: quota.remaining - 1, generation })
                .deliver(MessageDelivery::onchain_unconstrained().with_sender(player));
        }

        sponsor_and_hand_off(self.context, app_payload, player, policy.max_fee);
    }

    /// Binds the payload to the allowlist: every non-empty call must target a
    /// permitted contract, so sponsorship cannot be spent on anything else.
    /// A payload that fails this cannot be proven, so it never costs the
    /// paymaster anything.
    #[contract_library_method]
    fn assert_payload_allowed(
        app_payload: QuotaPayload,
        allowed_targets: [AztecAddress; MAX_ALLOWED_TARGETS],
    ) {
        let mut call_count: u32 = 0;
        for call in app_payload.function_calls {
            if !call.target_address.is_zero() {
                call_count += 1;
                let mut permitted = false;
                for allowed in allowed_targets {
                    if !allowed.is_zero() & (call.target_address == allowed) {
                        permitted = true;
                    }
                }
                assert(permitted, "Sponsored call targets a non-allowlisted contract");
                // `hide_msg_sender` would have the account forward the call with
                // a null sender, which breaks the guarantee this design exists
                // to provide: that the sponsored app still sees the real user.
                assert(!call.hide_msg_sender, "Sponsored calls must not hide the sender");
            }
        }
        // An empty payload does nothing but burn the sponsor's fee juice.
        assert(call_count > 0, "A sponsored transaction must do something");
    }

    /// Shared preamble: assert we are the transaction root, bind the payload,
    /// check the generation, and bound the transaction's lifetime.
    #[contract_library_method]
    fn begin_sponsorship(
        context: &mut PrivateContext,
        app_payload: QuotaPayload,
        allowed_targets: [AztecAddress; MAX_ALLOWED_TARGETS],
        generation: u32,
    ) {
        assert(
            context.maybe_msg_sender() == Option::none(),
            "QuotaFpc must be the transaction entrypoint",
        );
        assert_payload_allowed(app_payload, allowed_targets);
        assert_generation_fresh(context.get_anchor_block_header().timestamp(), generation);
        // Stops a stale anchor being used to reach back into an older generation.
        context.set_expiration_timestamp(
            ((generation as u64) + 1) * SECONDS_PER_DAY + EXPIRATION_SLACK_SECONDS,
        );
    }

    /// Shared tail: accept the fee, close the setup phase, and hand the payload
    /// to the user's account so the app observes the user as `msg_sender`.
    #[contract_library_method]
    fn sponsor_and_hand_off(
        context: &mut PrivateContext,
        app_payload: QuotaPayload,
        player: AztecAddress,
        max_fee: u128,
    ) {
        assert_fee_within_max(context.gas_settings(), max_fee);
        context.set_as_fee_payer();
        context.end_setup();

        // Selector of `AccountActions::entrypoint`, verified against
        // SchnorrInitializerlessAccount's artifact (0x9d57a239). Arrays use
        // [T;N] notation in selector signatures, not flattened tuples.
        let selector = comptime {
            FunctionSelector::from_signature(
                "entrypoint(([(Field,(u32),(Field),bool,bool,bool);5],Field),u8,bool)",
            )
        };

        let mut args = [0; 33];
        let payload_fields = app_payload.serialize();
        for i in 0..31 {
            args[i] = payload_fields[i];
        }
        args[31] = FEE_PAYMENT_EXTERNAL as Field;
        args[32] = 0; // cancellable = false

        // Hashes the args and stores the preimage in the execution cache, which
        // the account's circuit needs in order to resolve them.
        let _ = context.call_private_function(player, selector, args);
    }

    // ------------------------------------------------------------------
    // Read-only helpers (used by the client to render the allowance)
    // ------------------------------------------------------------------

    #[external("utility")]
    unconstrained fn get_policy() -> Policy {
        self.storage.policy.read()
    }

    #[external("utility")]
    unconstrained fn get_allowed_targets() -> [AztecAddress; MAX_ALLOWED_TARGETS] {
        self.storage.allowed_targets.read()
    }

    /// (has_allowance, remaining) for a player in a generation. `has_allowance`
    /// false means either "not subscribed yet" or "exhausted"; the client
    /// distinguishes them via the player nullifier.
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
    unconstrained fn compute_seat_nullifier(generation: u32, seat: u32) -> Field {
        compute_seat_nullifier_inner(generation, seat)
    }

    #[external("utility")]
    unconstrained fn compute_player_nullifier(generation: u32, player: AztecAddress) -> Field {
        compute_player_nullifier_inner(generation, player)
    }
}
