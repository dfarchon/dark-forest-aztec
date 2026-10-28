use std::meta::ctstring::AsCtString;
use std::meta::function_def::FunctionParameter;
use std::meta::type_def::StructField;

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
    let state = event.fields(@[])[2].typ();
    let encoded = quote { [Field; <$state as aztec::protocol::traits::Serialize>::N] }.as_type();
    let width = encoded.as_array().unwrap().length_type().as_constant().unwrap();
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
            fn encode_update(id: Field, block_number: u32, state: $state) -> (Field, [Field; $width + 3]) {
                let fields = $fields;
                ($root, [$words])
            }
        }
    }
}

comptime fn state_fields(typ: Type, value: Quoted) -> [Quoted] {
    let encoded = quote { [Field; <$typ as aztec::protocol::traits::Serialize>::N] }.as_type();
    if encoded.as_array().unwrap().length_type().as_constant().unwrap() == 1 {
        @[quote { aztec::protocol::traits::Serialize::serialize($value)[0] }]
    } else {
        let mut fields: [Quoted] = @[];
        if typ.as_array().is_some() {
            let array = typ.as_array().unwrap();
            let element = array.element_type();
            let length = array.length_type();
            for i in 0..length.as_constant().unwrap() {
                fields = fields.append(state_fields(element, quote { $value[$i] }));
            }
        } else {
            let data = typ.as_data_type().unwrap();
            let definition = data.definition();
            let generics = data.generics();
            for member in definition.fields(generics) {
                let name = member.name();
                let member_type = member.typ();
                fields = fields.append(state_fields(member_type, quote { $value.$name }));
            }
        }
        fields
    }
}

comptime fn serialize_state(typ: Type, value: Quoted) -> Quoted {
    let fields = state_fields(typ, quote { state }).join(quote { , });
    quote {
        {
            let state: $typ = $value;
            [$fields]
        }
    }
}

comptime fn is_batch(typ: Type) -> bool {
    if typ.as_array().is_none() {
        false
    } else {
        let length = typ.as_array().unwrap().length_type().as_constant().unwrap();
        (length == 5) | (length == 9) | (length == 20)
    }
}

// Expand public input arrays without changing the SDK's private-circuit decoder.
comptime fn read_public(typ: Type) -> Quoted {
    if is_batch(typ) {
        let array = typ.as_array().unwrap();
        let element = array.element_type();
        let length = array.length_type();
        let mut items: [Quoted] = @[];
        for _ in 0..length.as_constant().unwrap() {
            items = items.push_back(read_public(element));
        }
        let items = items.join(quote { , });
        quote { [$items] }
    } else if typ.as_data_type().is_some() {
        let data = typ.as_data_type().unwrap();
        let members = data.definition().fields(data.generics());
        if members.any(|member: StructField| is_batch(member.typ())) {
            let fields = members
                .map(|member: StructField| {
                    let name = member.name();
                    let read = read_public(member.typ());
                    quote { $name: $read }
                })
                .join(quote { , });
            quote { $typ { $fields } }
        } else {
            quote {
                <$typ as aztec::protocol::traits::Deserialize>::stream_deserialize(&mut reader)
            }
        }
    } else {
        quote { <$typ as aztec::protocol::traits::Deserialize>::stream_deserialize(&mut reader) }
    }
}

// Specialize fixed-size public argument reads after the SDK generates the contract.
// Element decoding still uses the SDK trait, including its range checks.
pub comptime fn world_contract(module: Module) -> Quoted {
    let helpers = storage_calls(module);
    let bodies = module.functions().map(|f: FunctionDefinition| f.body());
    let generated = aztec::macros::aztec(module, @[]);
    let tokens = rewrite_calls(generated, bodies).tokens();
    let read =
        quote { aztec::protocol::traits::Deserialize::stream_deserialize(&mut reader) }.tokens();
    // Prefix comparisons so the compiler never pretty-prints an unmatched closing brace.
    let open = quote { {} }.tokens()[0];
    let equal = |a: Quoted, b: Quoted| quote { $open $a } == quote { $open $b };
    let mut result: [Quoted] = @[];
    let mut skip = 0;
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
                replacement = read_public(typ);
                skip = i + read.len();
            }
            result = result.push_back(replacement);
        }
    }
    let result = result.join(quote {});
    quote { $result $helpers }
}

comptime fn optimized_method(name: Quoted) -> Option<Quoted> {
    if name == quote { set } {
        Option::some(quote { write })
    } else if name == quote { set_arrival_locations_max20 } {
        Option::some(quote { write_arrival_locations })
    } else if name == quote { verify_hash } {
        Option::some(quote { verify_hash_static })
    } else if name == quote { verify_hashes_batch } {
        Option::some(quote { verify_hashes_batch_static })
    } else if name == quote { is_initialized } {
        Option::some(quote { is_initialized_static })
    } else {
        Option::none()
    }
}

comptime fn storage_calls(module: Module) -> Quoted {
    let interface = module.name();
    let mut methods = quote {};
    for f in module.functions() {
        let name = f.name();
        if f.has_named_attribute("external") & optimized_method(name).is_some() {
            let writes = (name == quote { set }) | (name == quote { set_arrival_locations_max20 });
            assert(f.has_named_attribute("view") != writes, "Unexpected storage call mutability");
            let optimized = optimized_method(name).unwrap();
            let result = f.return_type();
            let params = f.parameters();
            let declarations = params
                .map(|param: FunctionParameter| {
                    let name = param.name();
                    let typ = param.typ();
                    quote { $name: $typ }
                })
                .join(quote { , });
            let zeros = params
                .map(|param: FunctionParameter| {
                    let typ = param.typ();
                    quote { std::mem::zeroed::<$typ>() }
                })
                .join(quote { , });
            let mut words: [Quoted] = @[quote { selector }];
            for parameter in params {
                words = words.append(state_fields(parameter.typ(), parameter.name()));
            }
            let words = words.join(quote { , });
            let call = if f.has_named_attribute("view") {
                quote { aztec::oracle::avm::call_static }
            } else {
                quote { aztec::oracle::avm::call }
            };
            methods = quote {
                $methods
                pub unconstrained fn $optimized(self, $declarations) -> $result {
                    let selector = comptime {
                        let call = $interface::interface().$name($zeros);
                        aztec::protocol::traits::ToField::to_field(call.selector)
                    };
                    $call(aztec::protocol::constants::MAX_U32_VALUE,
                        aztec::protocol::constants::MAX_U32_VALUE, self.target_contract, [$words]);
                    let success = aztec::oracle::avm::success_copy();
                    let returns = aztec::oracle::avm::returndata_copy(0, aztec::oracle::avm::returndata_size());
                    if !success { aztec::oracle::avm::revert(returns); }
                    <$result as aztec::protocol::traits::Deserialize>::deserialize(returns.as_array())
                }
            };
        }
    }
    quote { impl $interface { $methods } }
}

// Transform expression nodes: interpolated function bodies are opaque to token scans.
comptime fn rewrite_calls(code: Quoted, bodies: [Expr]) -> Quoted {
    let open = quote { {} }.tokens()[0];
    let mut replacements: [(CtString, Quoted)] = @[];
    for body in bodies {
        let mut count = 0;
        let replacement = rewrite_body(body, &mut count);
        if count != 0 {
            let key = quote { $open $body };
            replacements = replacements.push_back((f"{key}".as_ctstring(), replacement));
        }
    }
    if replacements.len() == 0 {
        code
    } else {
        code
            .tokens()
            .map(|token: Quoted| {
                let key = quote { $open $token };
                let key = f"{key}".as_ctstring();
                let matches = replacements.filter(|entry: (CtString, Quoted)| entry.0 == key);
                if matches.len() == 0 {
                    token
                } else {
                    matches[0].1
                }
            })
            .join(quote {})
    }
}

comptime fn rewrite_body(expr: Expr, rewritten: &mut u32) -> Quoted {
    let before = *rewritten;
    let mut out = expr.quoted();
    if expr.as_block().is_some() {
        let statements =
            expr.as_block().unwrap().map(|item: Expr| rewrite_body(item, rewritten)).join(quote {});
        out = quote { { $statements } };
    } else if expr.as_method_call().is_some() {
        let call = expr.as_method_call().unwrap();
        let receiver = call.receiver();
        let method = call.method_name();
        let generics = call.generics();
        let args = call.arguments();
        if (receiver.quoted() == quote { self }) & (generics.len() == 0) & (args.len() == 1) {
            if args[0].as_method_call().is_some() {
                let inner = args[0].as_method_call().unwrap();
                let target = inner.receiver();
                let name = inner.method_name();
                let inner_generics = inner.generics();
                let values = inner.arguments();
                let optimized = optimized_method(name);
                let writes =
                    (name == quote { set }) | (name == quote { set_arrival_locations_max20 });
                let valid =
                    ((method == quote { view }) & !writes) | ((method == quote { call }) & writes);
                if optimized.is_some() & valid & (inner_generics.len() == 0) {
                    let name = optimized.unwrap();
                    let values =
                        values.map(|value: Expr| rewrite_body(value, rewritten)).join(quote { , });
                    out = quote { $target.$name($values) };
                    *rewritten += 1;
                }
            }
        }
    } else if expr.as_unary_op().is_some() {
        let unary = expr.as_unary_op().unwrap();
        let operator = unary.operator();
        let value = unary.rhs();
        let operator = operator.quoted();
        let value = rewrite_body(value, rewritten);
        out = quote { ($operator($value)) };
    } else if expr.as_binary_op().is_some() {
        let binary = expr.as_binary_op().unwrap();
        let left = binary.lhs();
        let operator = binary.operator();
        let right = binary.rhs();
        let left = rewrite_body(left, rewritten);
        let right = rewrite_body(right, rewritten);
        let operator = operator.quoted();
        out = quote { (($left) $operator ($right)) };
    } else if expr.as_assert().is_some() {
        let assertion = expr.as_assert().unwrap();
        let condition = assertion.predicate();
        let message = assertion.message();
        let condition = rewrite_body(condition, rewritten);
        out = if message.is_some() {
            let message = message.unwrap();
            quote { assert($condition, $message) }
        } else {
            quote { assert($condition) }
        };
    } else if expr.as_let().is_some() {
        let binding = expr.as_let().unwrap();
        let pattern = binding.pattern();
        let typ = binding.typ();
        let value = binding.expression();
        let value = rewrite_body(value, rewritten);
        out = if typ.is_some() {
            let typ = typ.unwrap();
            quote { let $pattern: $typ = $value }
        } else {
            quote { let $pattern = $value }
        };
    } else if expr.as_assign().is_some() {
        let assignment = expr.as_assign().unwrap();
        let target = assignment.lhs();
        let value = assignment.rhs();
        let value = rewrite_body(value, rewritten);
        out = quote { $target = $value };
    } else if expr.as_if().is_some() {
        let branch = expr.as_if().unwrap();
        let condition = branch.condition();
        let then = branch.consequence();
        let otherwise = branch.alternative();
        let condition = rewrite_body(condition, rewritten);
        let then = rewrite_body(then, rewritten);
        out = if otherwise.is_some() {
            let otherwise = rewrite_body(otherwise.unwrap(), rewritten);
            quote { if $condition $then else $otherwise }
        } else {
            quote { if $condition $then }
        };
    } else if expr.as_for_range().is_some() {
        let range = expr.as_for_range().unwrap();
        let index = range.identifier();
        let start = range.start();
        let end = range.end();
        let inclusive = range.is_inclusive();
        let body = range.body();
        let body = rewrite_body(body, rewritten);
        out = if inclusive {
            quote { for $index in $start..=$end $body }
        } else {
            quote { for $index in $start..$end $body }
        };
    }
    if *rewritten == before {
        expr.quoted()
    } else if expr.has_semicolon() {
        quote { $out; }
    } else {
        out
    }
}

#[test]
fn rewrites_interpolated_bodies_and_preserves_sdk_checks() {
    comptime {
        let body =
            quote { { assert(self.view(store.verify_hash(id, hash)), "bad"); } }.as_expr().unwrap();
        let expected = quote { { assert(store.verify_hash_static(id, hash), "bad"); } };
        assert(rewrite_calls(quote { $body }, @[body]) == expected);
        for expression in @[
            quote { self.view(store.set(id, state)) },
            quote { self.call(store.verify_hash(id, hash)) },
            quote { self.view(store.verify_hash(id, hash).with_gas(gas)) },
            quote { self.view(store.other_method(id)) },
        ] {
            let mut count = 0;
            assert(rewrite_body(expression.as_expr().unwrap(), &mut count) == expression);
            assert(count == 0);
        }
    }
}
