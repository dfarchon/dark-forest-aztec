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
///  - An ADMIN can retune the policy and the target allowlist, but only through
///    a scheduled change that takes effect `UPDATE_DELAY_SECONDS` later. The
///    admin address is a constructor immutable with no transfer function, so
///    whoever deploys holds it permanently. The admin CANNOT withdraw anything
///    (fee juice is protocol-non-transferable), cannot shorten the delay, and
///    cannot touch `allowed_account_classes` or `require_unpublished_account`.
///    What it can do is redirect sponsorship, so key custody is part of this
///    contract's security model. NOTHING takes effect faster than the delay:
///    there is no pause and no emergency lever — the funded balance is the
///    real bound, so fund in tranches.
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
        history::deployment::assert_contract_bytecode_was_not_published_by,
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
        oracle::get_contract_instance::get_contract_instance,
        protocol::{
            abis::{function_selector::FunctionSelector, gas_settings::GasSettings},
            address::AztecAddress,
            hash::poseidon2_hash_with_separator,
            traits::{Deserialize, Packable, Serialize, ToField},
        },
        state_vars::{DelayedPublicMutable, Owned, PrivateSet, PublicImmutable, PublicMutable},
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
    /// Account-class allowlist capacity. Sponsorship hands execution to the
    /// player's own account contract, and a MALICIOUS account implementation
    /// could ignore the validated payload — so only known account classes are
    /// sponsored. A class id hashes the account artifact (version-specific,
    /// network-independent). Zero entries pad, as with targets.
    /// (Reference deployment: only the upstream initializerless Schnorr class —
    /// see `require_unpublished_account`, which is why the plain, published
    /// Schnorr variant is deliberately NOT listed.)
    global MAX_ALLOWED_ACCOUNT_CLASSES: u32 = 4;

    /// How long a scheduled configuration change waits before taking effect.
    /// Fixed here on purpose: no entrypoint can change it, so the key cannot
    /// shorten its own warning window. NOTHING in this contract takes effect
    /// faster than this — there is no pause and no fast lever.
    global UPDATE_DELAY_SECONDS: u64 = 43200; // 12 hours
    /// The delay the storage variable is BORN with. Must be zero so the
    /// constructor's first write lands immediately; the real delay is applied
    /// in the same constructor. See the ordering note there.
    global BOOTSTRAP_DELAY: u64 = 0;

    global SEAT_NULLIFIER_SEPARATOR: u32 = 1397047636; // "SEAT" (0x53454154)
    global PLAYER_NULLIFIER_SEPARATOR: u32 = 1347180882; // "PLYR" (0x504c5952)

    global SECONDS_PER_DAY: u64 = 86400;
    /// Tomorrow's generation is accepted only inside this window at the end of a
    /// day, so a transaction proven just before midnight can still land after it.
    /// Kept short to shrink the window in which tomorrow's seats can be claimed.
    global ROLLOVER_GRACE_SECONDS: u64 = 600;

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

    /// The mutable half of the configuration: the policy numbers AND the target
    /// allowlist, deliberately in ONE type. Both are read together by every
    /// private entrypoint, and aztec-nr's docs are explicit that values read
    /// together belong in one `DelayedPublicMutable` — each separate variable
    /// costs its own historical read (~4k gates) and its own transaction
    /// expiration tightening. The cost of bundling: only ONE change can be
    /// pending at a time across all four dials.
    #[derive(Deserialize, Eq, Packable, Serialize)]
    pub struct PolicyBundle {
        max_fee: u128,
        max_uses: u32,
        max_users: u32,
        allowed_targets: [AztecAddress; MAX_ALLOWED_TARGETS],
    }

    /// Tracks uses SPENT, not remaining. Remaining would be relative to the
    /// policy in force when the note was written, so clamping against a later,
    /// lower `max_uses` would over-grant: `remaining` already excludes the use
    /// consumed by subscribing, so `min(remaining, new_max_uses)` hands an
    /// existing subscriber one transaction too many. `spent` is absolute, so
    /// `spent < live.max_uses` is exact under any policy.
    ///
    /// `seat` is carried for the same reason on the other axis: lowering
    /// `max_users` must stop players admitted under a larger cap, otherwise an
    /// earlier cohort keeps spending under a later, higher `max_fee`.
    #[derive(Packable, Eq)]
    #[note]
    struct QuotaNote {
        spent: u32,
        seat: u32,
        generation: u32,
    }

    #[storage]
    struct Storage<Context> {
        /// Immutable. Whoever deploys holds this permanently — there is no
        /// transfer function, so handing control over means redeploying.
        admin: PublicImmutable<AztecAddress, Context>,
        settings: DelayedPublicMutable<PolicyBundle, BOOTSTRAP_DELAY, Context>,
        /// Monotonic, for compare-and-swap on scheduling. A timestamp cannot
        /// serve: it is retained after activation, is non-zero from the
        /// bootstrap write, and two replacements in one block share it.
        schedule_revision: PublicMutable<u64, Context>,
        allowed_account_classes: PublicImmutable<[Field; MAX_ALLOWED_ACCOUNT_CLASSES], Context>,
        require_unpublished_account: PublicImmutable<bool, Context>,
        quotas: Owned<PrivateSet<QuotaNote, Context>, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(
        admin: AztecAddress,
        max_fee: u128,
        max_uses: u32,
        max_users: u32,
        allowed_targets: [AztecAddress; MAX_ALLOWED_TARGETS],
        allowed_account_classes: [Field; MAX_ALLOWED_ACCOUNT_CLASSES],
        require_unpublished_account: bool,
    ) {
        // A zero admin would permanently brick updates: the address is
        // immutable and there is no transfer function.
        assert(!admin.is_zero(), "admin must not be the zero address");

        let bundle = PolicyBundle { max_fee, max_uses, max_users, allowed_targets };
        assert_bundle_sane(bundle);

        let mut any_class = false;
        for class in allowed_account_classes {
            if class != 0 {
                any_class = true;
            }
        }
        assert(any_class, "at least one allowed account class is required");

        self.storage.admin.initialize(admin);

        // ORDER IS LOAD-BEARING. `DelayedPublicMutable` has no direct-write
        // path — every write goes through the current delay, including the
        // first. The generic delay is therefore 0 so this write lands NOW; the
        // delay is raised immediately afterwards, which is allowed because
        // delay INCREASES take effect at once (decreases are themselves
        // delayed). Swap these two lines and the contract returns an all-zero
        // bundle — sponsoring nothing, silently — for the first 12 hours after
        // every deploy, because an unset delayed value reads as zeroes rather
        // than erroring.
        self.storage.settings.schedule_value_change(bundle);
        self.storage.settings.schedule_delay_change(UPDATE_DELAY_SECONDS);

        self.storage.schedule_revision.write(0);
        self.storage.allowed_account_classes.initialize(allowed_account_classes);
        self.storage.require_unpublished_account.initialize(require_unpublished_account);
    }

    /// Schedules a new configuration. Takes effect `UPDATE_DELAY_SECONDS` later.
    ///
    /// `expected_revision` is a compare-and-swap: scheduling always REPLACES any
    /// not-yet-active change (there is no queue), so without this two operators
    /// can each read "nothing pending", both write, and the later transaction
    /// silently discards the earlier one. An off-chain check cannot close that
    /// race; this can.
    #[external("public")]
    fn schedule_settings(bundle: PolicyBundle, expected_revision: u64) {
        assert_eq(self.storage.admin.read(), self.msg_sender(), "caller is not admin");
        assert_eq(
            self.storage.schedule_revision.read(),
            expected_revision,
            "settings changed since you last read them",
        );

        // The constructor's invariants must hold on the update path too. The
        // reference contract lost exactly these guards when its setter was
        // removed; a zero bundle is fail-closed but bricks sponsorship until a
        // further change can be scheduled and activated.
        assert_bundle_sane(bundle);

        self.storage.settings.schedule_value_change(bundle);
        self.storage.schedule_revision.write(expected_revision + 1);
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
        // Matches the protocol's own `GasSettings.getFeeLimit()`, which bills
        // `gas_limits x max_fees_per_gas` and does NOT add teardown — teardown is
        // already reserved within `gas_limits` at v5.0.1. The aztec-kit fork this
        // was adapted from adds teardown here, which makes the assert stricter
        // than actual billing and rejects transactions the protocol would happily
        // sponsor within `max_fee`. Verified against aztec-packages v5.0.1
        // yarn-project/stdlib/src/gas/gas_settings.ts:getFeeLimit.
        let gas = gas_settings.gas_limits;
        let max_possible_fee: u128 = (gas.da_gas as u128)
            * gas_settings.max_fees_per_gas.fee_per_da_gas
            + (gas.l2_gas as u128) * gas_settings.max_fees_per_gas.fee_per_l2_gas;
        assert(max_possible_fee <= max_fee, "Gas settings exceed the sponsorship allowance");
    }

    /// Invariants that must hold for ANY configuration, at construction and on
    /// every update alike.
    #[contract_library_method]
    fn assert_bundle_sane(bundle: PolicyBundle) {
        assert(bundle.max_fee > 0, "max_fee must be greater than zero");
        assert(bundle.max_uses > 0, "max_uses must be greater than zero");
        assert(bundle.max_users > 0, "max_users must be greater than zero");

        let mut any_target = false;
        for target in bundle.allowed_targets {
            if !target.is_zero() {
                any_target = true;
            }
        }
        assert(any_target, "at least one allowed target is required");
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
        // ONE read of the delayed bundle, not two. Each read costs a historical
        // public-storage proof and tightens this transaction's expiration.
        let settings = self.storage.settings.get_current_value();
        begin_sponsorship(
            self.context,
            app_payload,
            player,
            settings.allowed_targets,
            self.storage.allowed_account_classes.read(),
            self.storage.require_unpublished_account.read(),
            generation,
        );

        assert(seat < settings.max_users, "No sponsorship seats available today");
        // One subscription per player per generation.
        self.context.push_nullifier_unsafe(compute_player_nullifier_inner(generation, player));
        // Daily capacity: at most `max_users` seats can ever exist per generation.
        self.context.push_nullifier_unsafe(compute_seat_nullifier_inner(generation, seat));

        // Written before `end_setup` (below) so it is non-revertible: an app-call
        // revert must never consume a seat while losing the player's allowance.
        // This subscription IS the first use, hence `spent: 1`.
        //
        // The note is written unconditionally, even when it is already terminal
        // under the current policy. It records what the player has SPENT, not
        // what they have left, so it stays meaningful after the policy moves
        // underneath it — a later raise of `max_uses` becomes spendable instead
        // of being unreachable for want of a note. The player nullifier makes
        // re-subscribing impossible, so a missing note would strand that player
        // until the next daily rollover.
        self.storage.quotas.at(player).insert(QuotaNote { spent: 1, seat, generation }).deliver(
            MessageDelivery::onchain_unconstrained().with_sender(player),
        );

        sponsor_and_hand_off(self.context, app_payload, player, settings.max_fee);
    }

    /// A player's subsequent sponsored transactions of the day.
    #[external("private")]
    #[allow_phase_change]
    fn sponsor_and_execute(app_payload: QuotaPayload, player: AztecAddress, generation: u32) {
        let settings = self.storage.settings.get_current_value();
        begin_sponsorship(
            self.context,
            app_payload,
            player,
            settings.allowed_targets,
            self.storage.allowed_account_classes.read(),
            self.storage.require_unpublished_account.read(),
            generation,
        );

        let options = NoteGetterOptions::new().set_limit(1).select(
            QuotaNote::properties().generation,
            Comparator.EQ,
            generation,
        );
        let notes = self.storage.quotas.at(player).pop_notes(options);
        assert(notes.len() > 0, "No sponsored transactions remaining");
        let quota = notes.get(0);

        // Both dials are enforced against the CURRENT policy, not the one in
        // force when this note was written. A reduction therefore binds every
        // holder the moment it activates, so at most one policy era is ever
        // live and no earlier cohort can spend under a later, higher max_fee.
        assert(quota.spent < settings.max_uses, "No sponsored transactions remaining");
        // Distinct from the capacity message on the subscribe path: seats are
        // not full here, this player's seat fell outside a reduced cap.
        assert(quota.seat < settings.max_users, "Sponsorship seat no longer within capacity");

        // Re-inserted even when it is now terminal. Exhaustion is the assert
        // above (`spent < max_uses`), never the note's absence: dropping the
        // note would make a later raise of `max_uses` unreachable for exactly
        // the players who ran out, since the player nullifier bars them from
        // subscribing again. The cost is one note on the last transaction of a
        // player's day; the alternative is a raise that silently helps only
        // those who did not need it.
        let spent = quota.spent + 1;
        self
            .storage
            .quotas
            .at(player)
            .insert(QuotaNote { spent, seat: quota.seat, generation })
            .deliver(MessageDelivery::onchain_unconstrained().with_sender(player));

        sponsor_and_hand_off(self.context, app_payload, player, settings.max_fee);
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

    /// The hand-off (below) trusts the player's account contract to execute the
    /// payload this contract just validated. A MALICIOUS account implementation
    /// could ignore the payload and run anything, so sponsorship is limited to
    /// account classes whose behavior is known. `get_contract_instance` returns
    /// the address preimage and proves it hashes to `player`, and the preimage
    /// commits to `original_contract_class_id` — so the class cannot be forged,
    /// and the check works even for accounts that were never deployed on-chain
    /// (initializerless accounts send no deploy transaction).
    ///
    /// THE ORIGINAL CLASS IS NOT THE EXECUTED CLASS. Private context exposes
    /// only `original_contract_class_id`, while the private kernel validates
    /// the called function against the contract's CURRENT class — which
    /// `ContractInstanceRegistry::update` can change. An account whose class is
    /// allowlisted could therefore schedule an upgrade to hostile code and,
    /// after the delay, be sponsored while executing something else entirely:
    /// exactly the hole this check exists to close.
    ///
    /// What makes the binding sound is that both `update` and
    /// `set_update_delay` assert "msg.sender is not deployed" — they require
    /// the account's address nullifier to exist, i.e. the instance must have
    /// been PUBLISHED. An account proven unpublished as of the anchor block
    /// therefore cannot have been updated by then.
    ///
    /// Publishing AFTER the anchor is not caught by this already-built proof.
    /// What covers that window is the kernel, not this check: every private
    /// account call reads the account's updated-class slot, and the kernel caps
    /// the transaction's expiration at that read's time horizon — for an empty
    /// entry, the default 86,400s update delay. So the transaction expires
    /// before any update scheduled after the anchor could activate, and delay
    /// reductions are themselves delayed. (Verified against v5.0.1:
    /// private_kernel_circuit_output_composer.nr and validate_contract_address.nr.)
    ///
    /// Together, `require_unpublished_account` upgrades the class binding from
    /// "the class it was created with" to "the class that will execute".
    ///
    /// Deployments that must sponsor published accounts can turn it off, at the
    /// cost of accepting the upgrade path above; the reference deployment does
    /// not, because the embedded wallet's accounts are never published.
    ///
    /// Known consequence: anyone holding a user's address preimage can publish
    /// that instance (universal instances especially), which permanently ends
    /// sponsorship for them and puts their instance metadata on chain. That is
    /// griefing and a privacy leak, not a takeover — publishing cannot alter
    /// the preimage, and `update` acts only on its own `msg_sender`.
    #[contract_library_method]
    fn assert_player_account_allowed(
        context: &mut PrivateContext,
        player: AztecAddress,
        allowed_account_classes: [Field; MAX_ALLOWED_ACCOUNT_CLASSES],
        require_unpublished_account: bool,
    ) {
        let instance = get_contract_instance(player);
        let class_id = instance.original_contract_class_id.to_field();
        let mut permitted = false;
        for allowed in allowed_account_classes {
            if (allowed != 0) & (class_id == allowed) {
                permitted = true;
            }
        }
        assert(permitted, "Player account class is not sponsored");

        if require_unpublished_account {
            // Unpublished => never updatable => the original class IS the
            // executing class. See the note above.
            assert_contract_bytecode_was_not_published_by(
                context.get_anchor_block_header(),
                player,
            );
        }
    }

    /// Shared preamble: assert we are the transaction root, bind the payload,
    /// bind the player's account class, check the generation, and bound the
    /// transaction's lifetime.
    #[contract_library_method]
    fn begin_sponsorship(
        context: &mut PrivateContext,
        app_payload: QuotaPayload,
        player: AztecAddress,
        allowed_targets: [AztecAddress; MAX_ALLOWED_TARGETS],
        allowed_account_classes: [Field; MAX_ALLOWED_ACCOUNT_CLASSES],
        require_unpublished_account: bool,
        generation: u32,
    ) {
        assert(
            context.maybe_msg_sender() == Option::none(),
            "QuotaFpc must be the transaction entrypoint",
        );
        assert_payload_allowed(app_payload, allowed_targets);
        assert_player_account_allowed(
            context,
            player,
            allowed_account_classes,
            require_unpublished_account,
        );
        assert_generation_fresh(context.get_anchor_block_header().timestamp(), generation);

        // NOTE: an earlier version also tightened the transaction's expiration to
        // the end of the generation, as belt-and-braces against a stale anchor
        // reaching back. It was removed after it rejected valid transactions in
        // practice: late in a UTC day the generation's end is only hours away,
        // and a network whose block timestamps advance unevenly (catching up to
        // L1 slots, as local networks do) can pass that before the transaction is
        // validated — surfacing as "Invalid expiration timestamp" with nothing to
        // suggest the paymaster caused it.
        //
        // The freshness assert above is the real control: it already fixes which
        // generation may be spent. The protocol independently refuses any
        // transaction anchored more than 24h back.
        //
        // Exposure without the tightening: an anchor may be up to 24h old, so
        // around a rollover the previous, current and next generations can all be
        // spendable at once — about three, not two. Each is separately bounded by
        // max_users x max_uses x max_fee, and all of it by the balance.
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

    /// The policy CURRENTLY in force. Signature unchanged so the client needs
    /// no change: it re-reads per transaction and caches nothing.
    #[external("utility")]
    unconstrained fn get_policy() -> Policy {
        let s = self.storage.settings.get_current_value();
        Policy { max_fee: s.max_fee, max_uses: s.max_uses, max_users: s.max_users }
    }

    #[external("utility")]
    unconstrained fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }

    #[external("utility")]
    unconstrained fn get_allowed_targets() -> [AztecAddress; MAX_ALLOWED_TARGETS] {
        self.storage.settings.get_current_value().allowed_targets
    }

    /// What is scheduled but not yet live, plus the revision to pass back as
    /// `expected_revision`. A public view rather than a utility function
    /// because scheduled values are only exposed on `PublicContext`; operator
    /// tooling simulates this, so it costs no gas and sends no transaction.
    ///
    /// When nothing has been scheduled since the last activation this still
    /// returns the last scheduled bundle and its (past) timestamp — compare the
    /// timestamp against now to tell "pending" from "already in force".
    #[external("public")]
    fn get_scheduled_settings() -> (PolicyBundle, u64, u64) {
        let (bundle, timestamp_of_change) = self.storage.settings.get_scheduled_value();
        (bundle, timestamp_of_change, self.storage.schedule_revision.read())
    }

    #[external("utility")]
    unconstrained fn get_allowed_account_classes() -> [Field; MAX_ALLOWED_ACCOUNT_CLASSES] {
        self.storage.allowed_account_classes.read()
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
            // Derive against the LIVE policy, not against what was in force
            // when the note was written. Otherwise the badge would keep showing
            // an allowance a reduction has already taken away, and the player
            // would only discover it when a transaction failed.
            let quota = notes.get(0);
            let settings = self.storage.settings.get_current_value();
            let usable = (quota.spent < settings.max_uses) & (quota.seat < settings.max_users);
            if usable {
                (true, settings.max_uses - quota.spent)
            } else {
                (false, 0)
            }
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
