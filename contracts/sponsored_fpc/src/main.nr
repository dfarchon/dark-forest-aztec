use aztec::macros::aztec;

/// A fee-paying contract for Dark Forest with no per-user, per-day, seat, or
/// generation quota. Its FeeJuice balance is the total sponsorship budget.
#[aztec]
contract SponsoredFpc {
    use aztec::{
        authwit::entrypoint::FunctionCall,
        context::PrivateContext,
        history::deployment::assert_contract_bytecode_was_not_published_by,
        macros::{functions::{allow_phase_change, external, initializer}, storage::storage},
        oracle::get_contract_instance::get_contract_instance,
        protocol::{
            abis::{function_selector::FunctionSelector, gas_settings::GasSettings},
            address::AztecAddress,
            traits::{Deserialize, Serialize, ToField},
        },
        state_vars::PublicImmutable,
    };

    global ACCOUNT_MAX_CALLS: u32 = 5;
    global MAX_ALLOWED_TARGETS: u32 = 12;
    global MAX_ALLOWED_ACCOUNT_CLASSES: u32 = 4;
    global FEE_PAYMENT_EXTERNAL: u8 = 0;

    /// Layout-identical mirror of aztec-nr's AppPayload.
    #[derive(Deserialize, Serialize)]
    pub struct SponsoredPayload {
        function_calls: [FunctionCall; ACCOUNT_MAX_CALLS],
        pub tx_nonce: Field,
    }

    #[storage]
    struct Storage<Context> {
        max_fee: PublicImmutable<u128, Context>,
        allowed_targets: PublicImmutable<[AztecAddress; MAX_ALLOWED_TARGETS], Context>,
        allowed_account_classes: PublicImmutable<[Field; MAX_ALLOWED_ACCOUNT_CLASSES], Context>,
        require_unpublished_account: PublicImmutable<bool, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(
        max_fee: u128,
        allowed_targets: [AztecAddress; MAX_ALLOWED_TARGETS],
        allowed_account_classes: [Field; MAX_ALLOWED_ACCOUNT_CLASSES],
        require_unpublished_account: bool,
    ) {
        assert(max_fee > 0, "max_fee must be greater than zero");
        let mut any_target = false;
        for target in allowed_targets {
            if !target.is_zero() {
                any_target = true;
            }
        }
        assert(any_target, "at least one allowed target is required");

        let mut any_account_class = false;
        for class_id in allowed_account_classes {
            if class_id != 0 {
                any_account_class = true;
            }
        }
        assert(any_account_class, "at least one allowed account class is required");

        self.storage.max_fee.initialize(max_fee);
        self.storage.allowed_targets.initialize(allowed_targets);
        self.storage.allowed_account_classes.initialize(allowed_account_classes);
        self.storage.require_unpublished_account.initialize(require_unpublished_account);
    }

    /// Validate a user-signed payload, pay its fee, then hand the exact payload
    /// to the user's account entrypoint. The game still sees the user as sender.
    #[external("private")]
    #[allow_phase_change]
    fn sponsor_and_execute(app_payload: SponsoredPayload, player: AztecAddress) {
        assert(
            self.context.maybe_msg_sender() == Option::none(),
            "SponsoredFpc must be the transaction entrypoint",
        );
        assert_payload_allowed(app_payload, self.storage.allowed_targets.read());
        assert_player_account_allowed(
            self.context,
            player,
            self.storage.allowed_account_classes.read(),
            self.storage.require_unpublished_account.read(),
        );
        sponsor_and_hand_off(
            self.context,
            app_payload,
            player,
            self.storage.max_fee.read(),
        );
    }

    #[contract_library_method]
    fn assert_payload_allowed(
        app_payload: SponsoredPayload,
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
                assert(!call.hide_msg_sender, "Sponsored calls must not hide the sender");
            }
        }
        assert(call_count > 0, "A sponsored transaction must do something");
    }

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
            assert_contract_bytecode_was_not_published_by(
                context.get_anchor_block_header(),
                player,
            );
        }
    }

    #[contract_library_method]
    fn assert_fee_within_max(gas_settings: GasSettings, max_fee: u128) {
        let gas = gas_settings.gas_limits;
        let max_possible_fee: u128 = (gas.da_gas as u128)
            * gas_settings.max_fees_per_gas.fee_per_da_gas
            + (gas.l2_gas as u128) * gas_settings.max_fees_per_gas.fee_per_l2_gas;
        assert(max_possible_fee <= max_fee, "Gas settings exceed the sponsorship allowance");
    }

    #[contract_library_method]
    fn sponsor_and_hand_off(
        context: &mut PrivateContext,
        app_payload: SponsoredPayload,
        player: AztecAddress,
        max_fee: u128,
    ) {
        assert_fee_within_max(context.gas_settings(), max_fee);
        context.set_as_fee_payer();
        context.end_setup();

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
        args[32] = 0;
        let _ = context.call_private_function(player, selector, args);
    }

    #[external("utility")]
    unconstrained fn get_max_fee() -> u128 {
        self.storage.max_fee.read()
    }

    #[external("utility")]
    unconstrained fn get_allowed_targets() -> [AztecAddress; MAX_ALLOWED_TARGETS] {
        self.storage.allowed_targets.read()
    }

    #[external("utility")]
    unconstrained fn get_allowed_account_classes() -> [Field; MAX_ALLOWED_ACCOUNT_CLASSES] {
        self.storage.allowed_account_classes.read()
    }
}
