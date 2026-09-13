use aztec::context::{calls::PublicStaticCall, PublicContext, UtilityContext};
use aztec::oracle::{
    avm::{address, nullifier_exists, storage_read, storage_write},
    get_contract_instance::get_contract_instance_current_class_id_avm,
};
use aztec::protocol::{
    address::AztecAddress,
    constants::{
        CONTRACT_INSTANCE_REGISTRY_CONTRACT_ADDRESS, DOM_SEP__PUBLIC_INITIALIZATION_NULLIFIER,
        UPDATED_CLASS_IDS_SLOT,
    },
    hash::{compute_siloed_nullifier, poseidon2_hash, poseidon2_hash_with_separator},
    storage::map::derive_storage_slot_in_map,
    traits::ToField,
};

use aztec::state_vars::{PublicMutable, StateVariable};

pub global CONFIG_CLASS: Field = 0;
pub global FACADE_CLASSES: [Field; 9] = [0; 9];
pub global STATE_ROOTS: Field = 6;

unconstrained fn matches_initialized_class(namespace: AztecAddress, expected: Field) -> bool {
    if expected == 0 {
        false
    } else {
        let actual = get_contract_instance_current_class_id_avm(namespace);
        if actual.is_none() {
            false
        } else if actual.unwrap().to_field() != expected {
            false
        } else {
            // Match the public initializer guard before bypassing the original view.
            let initializer = poseidon2_hash_with_separator(
                [namespace.to_field()],
                DOM_SEP__PUBLIC_INITIALIZATION_NULLIFIER,
            );
            nullifier_exists(compute_siloed_nullifier(namespace, initializer))
        }
    }
}

pub unconstrained fn is_canonical(namespace: AztecAddress, kind: u8) -> bool {
    cached_initialized_class(namespace, FACADE_CLASSES[(kind - 1) as u32])
}

pub unconstrained fn is_config_canonical(namespace: AztecAddress) -> bool {
    cached_initialized_class(namespace, CONFIG_CLASS)
}

pub trait RootView<let N: u32> {
    unconstrained fn view_canonical(self, context: PublicContext, canonical: bool) -> bool;
}

unconstrained fn get_state_root(namespace: AztecAddress, key: Field) -> Field {
    storage_read(
        derive_storage_slot_in_map(STATE_ROOTS, key),
        namespace.to_field(),
    )
}

impl<let M: u32> RootView<2> for PublicStaticCall<M, 2, bool> {
    unconstrained fn view_canonical(self, context: PublicContext, canonical: bool) -> bool {
        if canonical {
            get_state_root(self.target_contract, self.args[0]) == self.args[1]
        } else {
            self.view(context)
        }
    }
}

pub unconstrained fn verify_state<let M: u32, let N: u32>(
    context: PublicContext,
    canonical: bool,
    call: PublicStaticCall<M, N, bool>,
    is_zero: bool,
) -> bool {
    if canonical {
        let root = get_state_root(call.target_contract, call.args[0]);
        if root == 0 {
            is_zero
        } else {
            let mut fields: [Field; N - 1] = [0; N - 1];
            for i in 0..N - 1 {
                fields[i] = call.args[i + 1];
            }
            poseidon2_hash(fields) == root
        }
    } else {
        call.view(context)
    }
}

impl<let M: u32> RootView<1> for PublicStaticCall<M, 1, bool> {
    unconstrained fn view_canonical(self, context: PublicContext, canonical: bool) -> bool {
        if canonical {
            get_state_root(self.target_contract, self.args[0]) != 0
        } else {
            self.view(context)
        }
    }
}

impl<let M: u32> RootView<41> for PublicStaticCall<M, 41, bool> {
    unconstrained fn view_canonical(self, context: PublicContext, canonical: bool) -> bool {
        if canonical {
            let count = self.args[40] as u32;
            assert(count <= 20, "count exceeds batch size");
            let mut result = true;
            for i in 0..count {
                if result & (self.args[i] != 0) {
                    result =
                        get_state_root(self.target_contract, self.args[i]) == self.args[i + 20];
                }
            }
            result
        } else {
            self.view(context)
        }
    }
}

pub unconstrained fn verify_config_hashes<let M: u32>(
    context: PublicContext,
    canonical: bool,
    call: PublicStaticCall<M, 11, bool>,
) -> bool {
    if canonical {
        let slots: [Field; 9] = [287, 286, 288, 289, 296, 290, 291, 292, 293];
        let mut result = true;
        for i in 0..9 {
            result = result
                & (storage_read(slots[i], call.target_contract.to_field()) == call.args[i + 2]);
        }
        result
            & (
                storage_read(
                    derive_storage_slot_in_map(299, call.args[0]),
                    call.target_contract.to_field(),
                )
                    == call.args[1]
            )
    } else {
        call.view(context)
    }
}

pub unconstrained fn verify_artifacts_config_hash<let M: u32>(
    context: PublicContext,
    canonical: bool,
    call: PublicStaticCall<M, 1, bool>,
) -> bool {
    if canonical {
        storage_read(294, call.target_contract.to_field()) == call.args[0]
    } else {
        call.view(context)
    }
}

pub unconstrained fn must_call_location_batch(
    context: PublicContext,
    canonical: bool,
    namespace: AztecAddress,
    ids: [Field; 20],
    count: u32,
) -> bool {
    if !canonical | (count > 20) {
        true
    } else {
        let mut active = false;
        for i in 0..count {
            active = active | (ids[i] != 0);
        }
        if active {
            true
        } else {
            // Bound classes cannot change mid-call; earlier setters may change permissions.
            let caller = context.this_address().to_field();
            let admin = storage_read(1, namespace.to_field());
            let grant = storage_read(derive_storage_slot_in_map(2, caller), namespace.to_field());
            if (grant != 0) & (grant != 1) {
                true
            } else {
                !((admin == caller) | (grant == 1))
            }
        }
    }
}

// The pinned Poseidon2 sponge has rate 3 and a length-based IV.
pub comptime fn fixed_state_hash(fields: Quoted, width: u32) -> Quoted {
    let iv = width as Field * 18446744073709551616;
    let mut body = quote { let state: [Field; 4] = [0, 0, 0, $iv]; };
    for start in 0..((width + 2) / 3) {
        let mut lanes: [Quoted] = @[];
        for offset in 0..3 {
            let index = start * 3 + offset;
            lanes = lanes.push_back(
                if index < width {
                    quote { state[$offset] + $fields[$index] }
                } else {
                    quote { state[$offset] }
                },
            );
        }
        let lanes = lanes.join(quote { , });
        body = quote { $body let state = std::hash::poseidon2_permutation([$lanes, state[3]]); };
    }
    if width == 0 {
        body = quote { $body let state = std::hash::poseidon2_permutation(state); };
    }
    quote { { $body state[0] } }
}

pub comptime fn state_update(event: Type, id: Quoted, block: Quoted, fields: Quoted) -> Quoted {
    let encoded = quote { [Field; <$event as aztec::protocol::traits::Serialize>::N] }.as_type();
    let width = encoded.as_array().unwrap().1.as_constant().unwrap();
    let tag = quote { comptime { aztec::protocol::hash::compute_log_tag(aztec::protocol::traits::ToField::to_field(<$event as aztec::event::event_interface::EventInterface>::get_event_type_id()), aztec::protocol::constants::DOM_SEP__EVENT_LOG_TAG) } };
    let mut words: [Quoted] = @[tag, id, quote { $block as Field }];
    for i in 0..(width - 2) {
        words = words.push_back(quote { $fields[$i] });
    }
    let words = words.join(quote { , });
    let root = fixed_state_hash(fields, width - 2);
    quote { ($root, [$words]) }
}

// A separate map domain; the address itself still occupies its original slot.
global CANONICAL_CACHE_SLOT: Field = 0x64662e63616e6f6e6963616c2d616464726573732e7631;

fn canonical_cache_slot(namespace: AztecAddress, expected: Field) -> Field {
    derive_storage_slot_in_map(CANONICAL_CACHE_SLOT + expected, namespace)
}

unconstrained fn cached_initialized_class(namespace: AztecAddress, expected: Field) -> bool {
    if storage_read(
        canonical_cache_slot(namespace, expected),
        address().to_field(),
    )
        == 1 {
        true
    } else {
        matches_initialized_class(namespace, expected)
    }
}

unconstrained fn remember_canonical(namespace: AztecAddress, expected: Field) {
    let slot = canonical_cache_slot(namespace, expected);
    if storage_read(slot, address().to_field()) != 1 {
        if matches_initialized_class(namespace, expected) {
            // No update record proves the current class is the original class.
            let updates = derive_storage_slot_in_map(UPDATED_CLASS_IDS_SLOT as Field, namespace);
            let mut original = true;
            for i in 0..4 {
                original = original
                    & (
                        storage_read(
                            updates + i as Field,
                            CONTRACT_INSTANCE_REGISTRY_CONTRACT_ADDRESS.to_field(),
                        )
                            == 0
                    );
            }
            if original {
                storage_write(slot, 1);
            }
        }
    }
}

pub struct CanonicalAddress<let Kind: u32, Context> {
    value: PublicMutable<AztecAddress, Context>,
}

impl<let Kind: u32, Context> StateVariable<1, Context> for CanonicalAddress<Kind, Context> {
    fn new(context: Context, storage_slot: Field) -> Self {
        Self { value: PublicMutable::new(context, storage_slot) }
    }

    fn get_storage_slot(self) -> Field {
        self.value.get_storage_slot()
    }
}

impl<let Kind: u32> CanonicalAddress<Kind, PublicContext> {
    pub fn read(self) -> AztecAddress {
        self.value.read()
    }

    pub unconstrained fn write(self, value: AztecAddress) {
        self.value.write(value);
        let expected = if Kind == 0 {
            CONFIG_CLASS
        } else {
            FACADE_CLASSES[(Kind - 1) as u32]
        };
        remember_canonical(value, expected);
    }
}

impl<let Kind: u32> CanonicalAddress<Kind, UtilityContext> {
    pub unconstrained fn read(self) -> AztecAddress {
        self.value.read()
    }
}
