use aztec::macros::aztec;

/// Spike 1B: the "sandwich" FPC — Option 1 from research/call-binding.md.
///
/// This contract is the TRANSACTION ORIGIN (not a sibling call). Flow:
///   tx origin = SandwichFpc.entrypoint(app_payload, player)
///     -> assert every non-empty call in app_payload targets an allowlisted contract  (CALL BINDING)
///     -> quota bookkeeping + set_as_fee_payer + end_setup                            (SPONSORSHIP)
///     -> call player_account.entrypoint(app_payload, EXTERNAL, false)                (HAND-OFF)
///          -> account verifies the player's signature over app_payload
///          -> account executes the calls, so the app sees msg_sender == PLAYER ACCOUNT
///
/// The evidence spike 1B needs is whether that last line actually holds.
#[aztec]
contract SandwichFpc {
    use aztec::{
        authwit::entrypoint::FunctionCall,
        macros::{
            functions::{allow_phase_change, external, initializer},
            storage::storage,
        },
        protocol::{
            abis::function_selector::FunctionSelector,
            address::AztecAddress,
            traits::{Deserialize, Packable, Serialize},
        },
        state_vars::PublicImmutable,
    };

    global ACCOUNT_MAX_CALLS: u32 = 5;

    /// Layout-identical mirror of `aztec::authwit::entrypoint::app::AppPayload`
    /// (whose `function_calls` field is private, so we cannot iterate the
    /// upstream struct from here). Serialization MUST match upstream exactly:
    /// 5 x FunctionCall (6 fields each) followed by tx_nonce = 31 fields, which
    /// is what the player signed and what the account contract deserializes.
    #[derive(Deserialize, Serialize)]
    pub struct SandwichPayload {
        function_calls: [FunctionCall; ACCOUNT_MAX_CALLS],
        pub tx_nonce: Field,
    }

    /// `AccountFeePaymentMethodOptions.EXTERNAL` — tells the account contract
    /// "someone else pays"; it must NOT touch fee payer or setup phase (we
    /// already ended setup before handing off).
    global FEE_PAYMENT_EXTERNAL: u8 = 0;

    #[derive(Deserialize, Eq, Packable, Serialize)]
    pub struct SandwichConfig {
        /// Single allowlisted app contract for the spike. Production would
        /// hold a set (the DF system contracts).
        allowed_target: AztecAddress,
    }

    #[storage]
    struct Storage<Context> {
        config: PublicImmutable<SandwichConfig, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(allowed_target: AztecAddress) {
        self.storage.config.initialize(SandwichConfig { allowed_target });
    }

    /// Transaction entrypoint. Must be the tx root: nothing may call it.
    #[external("private")]
    #[allow_phase_change]
    fn entrypoint(app_payload: SandwichPayload, player: AztecAddress) {
        assert(
            self.context.maybe_msg_sender() == Option::none(),
            "SandwichFpc must be the tx entrypoint",
        );

        let config = self.storage.config.read();

        // ---- CALL BINDING: every non-empty call must target the allowlist ----
        // A payload aimed anywhere else cannot be proven, so sponsorship is
        // structurally restricted to the app.
        for call in app_payload.function_calls {
            if !call.target_address.is_zero() {
                assert(
                    call.target_address == config.allowed_target,
                    "Sponsored call targets a non-allowlisted contract",
                );
            }
        }

        // ---- SPONSORSHIP ----
        // (Quota bookkeeping goes here in the real contract; spike 1B is about
        // the call shape, and spike 1A already proves the quota mechanics.)
        self.context.set_as_fee_payer();
        self.context.end_setup();

        // ---- HAND-OFF to the player's own account ----
        // The account verifies the player's signature over app_payload and
        // executes the calls itself, so the app sees the player as msg_sender.
        // Verified against SchnorrInitializerlessAccount's artifact: 0x9d57a239.
        // Arrays use [T;N] notation in selector signatures, not flattened tuples.
        let selector = comptime {
            FunctionSelector::from_signature("entrypoint(([(Field,(u32),(Field),bool,bool,bool);5],Field),u8,bool)")
        };

        let mut args = [0; 33];
        let payload_fields = app_payload.serialize();
        for i in 0..31 {
            args[i] = payload_fields[i];
        }
        args[31] = FEE_PAYMENT_EXTERNAL as Field;
        args[32] = 0; // cancellable = false

        // call_private_function hashes the args AND stores the preimage in the
        // execution cache, which the account's circuit needs to resolve them.
        let _ = self.context.call_private_function(player, selector, args);
    }
}
