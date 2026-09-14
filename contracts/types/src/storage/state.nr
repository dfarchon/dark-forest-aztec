use aztec::context::{PublicContext, UtilityContext};
use aztec::oracle::{
    avm::{address, nullifier_exists, storage_read, storage_write},
    get_contract_instance::get_contract_instance_current_class_id_avm,
};
use aztec::protocol::{
    address::AztecAddress,
    constants::{
        CONTRACT_INSTANCE_REGISTRY_CONTRACT_ADDRESS, DOM_SEP__PUBLIC_INITIALIZATION_NULLIFIER,
        UPDATED_CLASS_IDS_SLOT, UPDATES_DELAYED_PUBLIC_MUTABLE_VALUES_LEN,
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

unconstrained fn get_state_root(namespace: AztecAddress, key: Field) -> Field {
    storage_read(
        derive_storage_slot_in_map(STATE_ROOTS, key),
        namespace.to_field(),
    )
}

pub unconstrained fn verify_hash<Key, Env>(
    canonical: bool,
    namespace: AztecAddress,
    key: Key,
    hash: Field,
    fallback: unconstrained fn[Env]() -> bool,
) -> bool
where
    Key: ToField,
{
    if canonical {
        get_state_root(namespace, key.to_field()) == hash
    } else {
        fallback()
    }
}

pub unconstrained fn is_initialized<Key, Env>(
    canonical: bool,
    namespace: AztecAddress,
    key: Key,
    fallback: unconstrained fn[Env]() -> bool,
) -> bool
where
    Key: ToField,
{
    if canonical {
        get_state_root(namespace, key.to_field()) != 0
    } else {
        fallback()
    }
}

pub unconstrained fn verify_hashes_batch<Env>(
    canonical: bool,
    namespace: AztecAddress,
    ids: [Field; 20],
    hashes: [Field; 20],
    count: u32,
    fallback: unconstrained fn[Env]() -> bool,
) -> bool {
    if canonical {
        assert(count <= 20, "count exceeds batch size");
        let mut result = true;
        for i in 0..count {
            if result & (ids[i] != 0) {
                result = get_state_root(namespace, ids[i]) == hashes[i];
            }
        }
        result
    } else {
        fallback()
    }
}

pub unconstrained fn verify_config_hashes<Env>(
    canonical: bool,
    namespace: AztecAddress,
    level: u8,
    default_stats_hash: Field,
    hashes: [Field; 9],
    fallback: unconstrained fn[Env]() -> bool,
) -> bool {
    if canonical {
        let slots: [Field; 9] = [287, 286, 288, 289, 296, 290, 291, 292, 293];
        let mut result = true;
        for i in 0..9 {
            result = result & (storage_read(slots[i], namespace.to_field()) == hashes[i]);
        }
        result
            & (
                storage_read(
                    derive_storage_slot_in_map(299, level as Field),
                    namespace.to_field(),
                )
                    == default_stats_hash
            )
    } else {
        fallback()
    }
}

pub unconstrained fn verify_artifacts_config_hash<Env>(
    canonical: bool,
    namespace: AztecAddress,
    hash: Field,
    fallback: unconstrained fn[Env]() -> bool,
) -> bool {
    if canonical {
        storage_read(294, namespace.to_field()) == hash
    } else {
        fallback()
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
            // The registry writes the update record and its hash atomically.
            let updates = derive_storage_slot_in_map(UPDATED_CLASS_IDS_SLOT as Field, namespace);
            if storage_read(
                updates + UPDATES_DELAYED_PUBLIC_MUTABLE_VALUES_LEN as Field,
                CONTRACT_INSTANCE_REGISTRY_CONTRACT_ADDRESS.to_field(),
            )
                == 0 {
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

pub comptime fn serialize_state(typ: Type, value: Quoted) -> Quoted {
    let (definition, generics) = typ.as_data_type().unwrap();
    let mut statements: [Quoted] = @[];
    let mut fields: [Quoted] = @[];
    for member in definition.fields(generics) {
        let (name, member_type, _) = member;
        let mut members = @[(member_type, quote { state.$name })];
        if member_type.as_array().is_some() {
            let (element_type, length) = member_type.as_array().unwrap();
            members = @[];
            for i in 0..length.as_constant().unwrap() {
                members = members.push_back((element_type, quote { state.$name[$i] }));
            }
        }
        for entry in members {
            let (member_type, member) = entry;
            let index = fields.len();
            let local = f"serialized_{index}".quoted_contents();
            statements = statements.push_back(
                quote {
                    let $local = aztec::protocol::traits::Serialize::serialize($member);
                },
            );
            let encoded = quote { [Field; <$member_type as aztec::protocol::traits::Serialize>::N] }
                .as_type();
            for i in 0..encoded.as_array().unwrap().1.as_constant().unwrap() {
                fields = fields.push_back(quote { $local[$i] });
            }
        }
    }
    let statements = statements.join(quote {});
    let fields = fields.join(quote { , });
    quote { {
        let state: $typ = $value;
        $statements
        let fields: [Field; <$typ as aztec::protocol::traits::Serialize>::N] = [$fields];
        fields
    } }
}

pub comptime fn set_state(
    interface: Quoted,
    state_type: Type,
    namespace: Quoted,
    id: Quoted,
    value: Quoted,
) -> Quoted {
    let encoded =
        quote { [Field; <$state_type as aztec::protocol::traits::Serialize>::N] }.as_type();
    let width = encoded.as_array().unwrap().1.as_constant().unwrap();
    let selector = quote {
        comptime {
            let state: $state_type = std::mem::zeroed();
            let call: aztec::context::calls::PublicCall<3, $width + 1, ()> =
                $interface::at(aztec::protocol::address::AztecAddress::zero()).set(std::mem::zeroed(), state);
            aztec::protocol::traits::ToField::to_field(call.selector)
        }
    };
    let mut calldata: [Quoted] =
        @[selector, quote { aztec::protocol::traits::ToField::to_field($id) }];
    for i in 0..width {
        calldata = calldata.push_back(quote { fields[$i] });
    }
    let calldata = calldata.join(quote { , });
    let fields = serialize_state(state_type, value);
    quote {
        {
            let fields = $fields;
            ::types::storage::state::call_void($namespace, [$calldata]);
        }
    }
}

// Keep the game's fixed arrays flat in public execution; retain SDK decoding in circuits.
pub comptime fn array_deserialize(definition: TypeDefinition) -> Quoted {
    let typ = definition.as_type();
    let (structure, generics) = typ.as_data_type().unwrap();
    let mut fields: [Quoted] = @[];
    let mut widths: [Quoted] = @[];
    for member in structure.fields(generics) {
        let (name, member_type, _) = member;
        widths =
            widths.push_back(quote { <$member_type as aztec::protocol::traits::Deserialize>::N });
        let mut read = quote {
            <$member_type as aztec::protocol::traits::Deserialize>::stream_deserialize(reader)
        };
        if member_type.as_array().is_some() {
            let (element, length) = member_type.as_array().unwrap();
            let mut items: [Quoted] = @[];
            for _ in 0..length.as_constant().unwrap() {
                items = items.push_back(
                    quote {
                        <$element as aztec::protocol::traits::Deserialize>::stream_deserialize(reader)
                    },
                );
            }
            let items = items.join(quote { , });
            read = quote {
                if std::runtime::is_unconstrained() {
                    [$items]
                } else {
                    $read
                }
            };
        }
        fields = fields.push_back(quote { $name: $read });
    }
    let fields = fields.join(quote { , });
    let width = widths.join(quote { + });
    quote {
        impl aztec::protocol::traits::Deserialize for $typ {
            let N: u32 = $width;
            fn deserialize(fields: [Field; Self::N]) -> Self {
                let mut reader = aztec::protocol::utils::reader::Reader::new(fields);
                let result = Self::stream_deserialize(&mut reader);
                reader.finish();
                result
            }
            #[inline_always]
            fn stream_deserialize<let K: u32>(reader: &mut aztec::protocol::utils::reader::Reader<K>) -> Self {
                Self { $fields }
            }
        }
    }
}

#[inline_always]
pub unconstrained fn call_void<let N: u32>(namespace: AztecAddress, calldata: [Field; N]) {
    aztec::oracle::avm::call(
        aztec::protocol::constants::MAX_U32_VALUE,
        aztec::protocol::constants::MAX_U32_VALUE,
        namespace,
        calldata,
    );
    let success = aztec::oracle::avm::success_copy();
    let returns = aztec::oracle::avm::returndata_copy(0, aztec::oracle::avm::returndata_size());
    if !success {
        aztec::oracle::avm::revert(returns);
    }
    let returns: [Field; 0] = returns.as_array();
    <() as aztec::protocol::traits::Deserialize>::deserialize(returns)
}

// Specialize fixed-size public argument reads after the SDK generates the contract.
// Element decoding still uses the SDK trait, including its range checks.
pub comptime fn game_contract(module: Module) -> Quoted {
    let tokens = aztec::macros::aztec(module, @[]).tokens();
    let read =
        quote { aztec::protocol::traits::Deserialize::stream_deserialize(&mut reader) }.tokens();
    // Prefix comparisons so the compiler never pretty-prints an unmatched closing brace.
    let open = quote { {} }.tokens()[0];
    let equal = |a: Quoted, b: Quoted| quote { $open $a } == quote { $open $b };
    let mut result: [Quoted] = @[];
    let mut skip = 0;
    let mut replacements = 0;
    for i in 0..tokens.len() {
        if i >= skip {
            let mut matches = (i >= 5) & (i + read.len() <= tokens.len());
            if matches {
                matches = equal(tokens[i - 1], quote { = })
                    & equal(tokens[i - 3], quote { : })
                    & equal(tokens[i - 5], quote { let });
                for j in 0..read.len() {
                    if matches {
                        matches = equal(tokens[i + j], read[j]);
                    }
                }
            }
            let mut replacement = tokens[i];
            if matches {
                let typ = tokens[i - 2].as_type();
                if typ.as_array().is_some() {
                    let (element, length) = typ.as_array().unwrap();
                    let length = length.as_constant().unwrap();
                    if (length == 5) | (length == 9) | (length == 20) {
                        let mut items: [Quoted] = @[];
                        for _ in 0..length {
                            items = items.push_back(
                                quote {
                                    <$element as aztec::protocol::traits::Deserialize>::stream_deserialize(&mut reader)
                                },
                            );
                        }
                        let items = items.join(quote { , });
                        replacement = quote { [$items] };
                        skip = i + read.len();
                        replacements += 1;
                    }
                }
            }
            result = result.push_back(replacement);
        }
    }
    assert(replacements > 0, "No game array reads found in generated dispatcher");
    result.join(quote {})
}
