use aztec::context::PublicContext;

pub trait WriteState<Key, State> {
    unconstrained fn write(self, id: Key, state: State);
}

pub trait VerifyHash<Key> {
    unconstrained fn verify_hash_canonical(
        self,
        context: PublicContext,
        id: Key,
        hash: Field,
        canonical: bool,
    ) -> bool;
}

pub trait IsInitialized<Key> {
    unconstrained fn is_initialized_canonical(
        self,
        context: PublicContext,
        id: Key,
        canonical: bool,
    ) -> bool;
}

pub trait VerifyHashesBatch {
    unconstrained fn verify_hashes_batch_canonical(
        self,
        context: PublicContext,
        ids: [Field; 20],
        hashes: [Field; 20],
        count: u32,
        canonical: bool,
    ) -> bool;
}

// Construct the original SDK call only when direct verification cannot be used.
#[storage_views]
mod implementations {}

comptime fn storage_views(_module: Module) -> Quoted {
    let contracts = [
        (
            quote { ::world_storage::WorldStorage::WorldStorage }, quote { Field },
            quote { ::types::storage::world::World }, false, false,
        ),
        (
            quote { ::player_storage::PlayerStorage::PlayerStorage },
            quote { ::aztec::protocol::address::AztecAddress },
            quote { ::types::storage::player::Player }, true, false,
        ),
        (
            quote { ::planet_storage::PlanetStorage::PlanetStorage }, quote { Field },
            quote { ::types::storage::planet::Planet }, true, false,
        ),
        (
            quote {
                ::planet_revealed_coords_storage::PlanetRevealedCoordsStorage::PlanetRevealedCoordsStorage
            }, quote { Field }, quote { ::types::storage::planet::PlanetRevealedCoords }, true,
            false,
        ),
        (
            quote { ::planet_events_storage::PlanetEventsStorage::PlanetEventsStorage },
            quote { Field }, quote { ::types::storage::planet::PlanetEvents }, true, false,
        ),
        (
            quote { ::planet_artifacts_storage::PlanetArtifactsStorage::PlanetArtifactsStorage },
            quote { Field }, quote { ::types::storage::planet::PlanetArtifacts }, true, false,
        ),
        (
            quote { ::arrival_storage::ArrivalStorage::ArrivalStorage }, quote { Field },
            quote { ::types::storage::arrival::Arrival }, true, true,
        ),
        (
            quote { ::artifact_storage::ArtifactStorage::ArtifactStorage }, quote { Field },
            quote { ::types::storage::artifact::Artifact }, true, true,
        ),
        (
            quote { ::artifact_location_storage::ArtifactLocationStorage::ArtifactLocationStorage },
            quote { Field }, quote { ::types::storage::artifact::ArtifactLocation }, true, true,
        ),
    ];
    let mut implementations = quote {};
    for entry in contracts {
        let (interface, key, state, initialized, batch) = entry;
        let write = ::types::storage::state::set_state(
            interface,
            state.as_type(),
            quote { self.target_contract },
            quote { id },
            quote { state },
        );
        implementations = quote {
            $implementations
            impl crate::storage::WriteState<$key, $state> for $interface {
                unconstrained fn write(self, id: $key, state: $state) { $write }
            }
            impl crate::storage::VerifyHash<$key> for $interface {
                unconstrained fn verify_hash_canonical(self, context: ::aztec::context::PublicContext, id: $key, hash: Field, canonical: bool) -> bool {
                    ::types::storage::state::verify_hash(canonical, self.target_contract, id, hash,
                        || self.verify_hash(id, hash).view(context))
                }
            }
        };
        if initialized {
            implementations = quote {
                $implementations
                impl crate::storage::IsInitialized<$key> for $interface {
                    unconstrained fn is_initialized_canonical(self, context: ::aztec::context::PublicContext, id: $key, canonical: bool) -> bool {
                        ::types::storage::state::is_initialized(canonical, self.target_contract, id,
                            || self.is_initialized(id).view(context))
                    }
                }
            };
        }
        if batch {
            implementations = quote {
                $implementations
                impl crate::storage::VerifyHashesBatch for $interface {
                    unconstrained fn verify_hashes_batch_canonical(self, context: ::aztec::context::PublicContext, ids: [Field; 20], hashes: [Field; 20], count: u32, canonical: bool) -> bool {
                        ::types::storage::state::verify_hashes_batch(canonical, self.target_contract, ids, hashes, count,
                            || self.verify_hashes_batch(ids, hashes, count).view(context))
                    }
                }
            };
        }
    }
    implementations
}

pub trait WriteArrivalLocations {
    unconstrained fn write_arrival_locations(
        self,
        ids: [Field; 20],
        states: [::types::storage::artifact::ArtifactLocation; 20],
        count: u32,
    );
}

impl WriteArrivalLocations for ::artifact_location_storage::ArtifactLocationStorage::ArtifactLocationStorage {
    unconstrained fn write_arrival_locations(
        self,
        ids: [Field; 20],
        states: [::types::storage::artifact::ArtifactLocation; 20],
        count: u32,
    ) {
        let calldata = std::meta::unquote!(arrival_locations_calldata());
        ::types::storage::state::call_void(self.target_contract, calldata);
    }
}

comptime fn arrival_locations_calldata() -> Quoted {
    let selector = quote {
        comptime {
            let call: ::aztec::context::calls::PublicCall<27, 81, ()> = ::artifact_location_storage::ArtifactLocationStorage::interface()
                .set_arrival_locations_max20([0; 20], std::mem::zeroed(), 0);
            ::aztec::protocol::traits::ToField::to_field(call.selector)
        }
    };
    let mut words: [Quoted] = @[selector];
    for i in 0..20 {
        words = words.push_back(quote { ids[$i] });
    }
    for i in 0..20 {
        words = words.push_back(quote { states[$i].planet_id });
        words = words.push_back(quote { states[$i].voyage_id });
        words = words.push_back(quote { states[$i].last_updated as Field });
    }
    words = words.push_back(quote { count as Field });
    let words = words.join(quote { , });
    quote { [$words] }
}
