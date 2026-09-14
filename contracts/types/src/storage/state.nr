use aztec::protocol::address::AztecAddress;

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

pub comptime fn state_update(event: TypeDefinition) -> Quoted {
    let name = event.name();
    let (_, state, _) = event.fields(@[])[2];
    let encoded = quote { [Field; <$state as aztec::protocol::traits::Serialize>::N] }.as_type();
    let width = encoded.as_array().unwrap().1.as_constant().unwrap();
    let tag = quote { comptime { aztec::protocol::hash::compute_log_tag(aztec::protocol::traits::ToField::to_field(<$name as aztec::event::event_interface::EventInterface>::get_event_type_id()), aztec::protocol::constants::DOM_SEP__EVENT_LOG_TAG) } };
    let mut words: [Quoted] = @[tag, quote { id }, quote { block_number as Field }];
    for i in 0..width {
        words = words.push_back(quote { fields[$i] });
    }
    let words = words.join(quote { , });
    let root = fixed_state_hash(quote { fields }, width);
    let fields = serialize_state(state, quote { state });
    quote {
        impl $name {
            #[inline_always]
            unconstrained fn encode_update(id: Field, block_number: u32, state: $state) -> (Field, [Field; $width + 3]) {
                let fields = $fields;
                ($root, [$words])
            }
        }
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

#[inline_always]
pub unconstrained fn static_bool<let N: u32>(
    namespace: AztecAddress,
    calldata: [Field; N],
) -> bool {
    aztec::oracle::avm::call_static(
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
    <bool as aztec::protocol::traits::Deserialize>::deserialize(returns.as_array())
}
