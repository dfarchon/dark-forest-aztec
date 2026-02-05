use dep::aztec::macros::aztec;

#[aztec]
contract Admin {
    use dep::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, view},
            storage::storage,
        },
        protocol_types::{address::AztecAddress, hash::poseidon2_hash, traits::Packable},
    };
    use dep::aztec::state_vars::{Map, PublicMutable};

    use dep::types::args::{
        AdminCreatePlanetArgs, DFPCreateArrivalArgs, DFPInitPlanetArgs, DFPMoveArgs,
    };

    use dep::types::config::{
        ArtifactsConfig, CaptureZonesConfig, GameConfig, GameConfigCore, PlanetDefaultStats,
        PlanetLevelThresholds, PlanetTypeWeightsTier, SnarkConstants, SpaceJunkConfig,
        SpaceshipsConfig, Upgrade, WorldConfig,
    };

    use dep::types::storage::{
        Arrival, ArrivalType, Artifact, ArtifactRarity, ArtifactState, ArtifactType, GlobalState,
        Planet, PlanetArtifacts, PlanetCaps, PlanetData, PlanetEventMetadata, PlanetEvents,
        PlanetEventType, PlanetFullState, PlanetMeta, PlanetMods, PlanetOwner, PlanetResources,
        PlanetType, Player, RevealedCoords, SpaceType, StateRoot, UpgradeBranch,
    };

    use dep::global_state_storage::GlobalStateStorage;
    use dep::planet_owner_storage::PlanetOwnerStorage;
    use dep::player_storage::PlayerStorage;

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        global_state_address: PublicMutable<AztecAddress, Context>,
        planet_owner_address: PublicMutable<AztecAddress, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(amdinAddress: AztecAddress) {
        self.storage.admin.write(amdinAddress);
    }

    #[internal("public")]
    fn assert_admin() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
    }

    #[internal("public")]
    fn get_global_state_address() -> AztecAddress {
        self.storage.global_state_address.read()
    }

    #[internal("public")]
    fn get_planet_owner_address() -> AztecAddress {
        self.storage.planet_owner_address.read()
    }

    #[external("public")]
    fn transfer_admin(new_admin: AztecAddress) {
        self.internal.assert_admin();
        self.storage.admin.write(new_admin);
    }

    #[external("public")]
    fn set_global_state_address(global_state_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.global_state_address.write(global_state_address);
    }

    #[external("public")]
    fn set_planet_owner_address(planet_owner_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_owner_address.write(planet_owner_address);
    }

    /// Pause the game. Verifies global_state matches on-chain state via GlobalStateStorage.verify(), then sets paused = true.
    #[external("public")]
    fn pause(global_state: GlobalState) {
        self.internal.assert_admin();

        let global_state_address = self.internal.get_global_state_address();
        let global_state_storage = GlobalStateStorage::at(global_state_address);
        let global_state_valid: bool = self.view(global_state_storage.verify(global_state));

        assert(global_state_valid, "Global state is not valid");
        assert(!global_state.paused, "Game is already paused");

        let mut new_global_state = global_state;
        new_global_state.paused = true;
        self.call(global_state_storage.update(new_global_state));
    }

    #[external("public")]
    fn unpause(global_state: GlobalState) {
        self.internal.assert_admin();
        let global_state_address = self.internal.get_global_state_address();
        let global_state_storage = GlobalStateStorage::at(global_state_address);

        let global_state_valid: bool = self.view(global_state_storage.verify(global_state));
        assert(global_state_valid, "Global state is not valid");
        assert(global_state.paused == true, "Game is already unpaused");

        let mut new_global_state = global_state;
        new_global_state.paused = false;
        self.call(global_state_storage.update(new_global_state));
    }

    #[external("public")]
    fn set_owner(planet_id: Field, planet_owner_state: PlanetOwner, new_owner: AztecAddress) {
        self.internal.assert_admin();
        let planet_owner_address = self.internal.get_planet_owner_address();
        let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_address);

        let planet_owner_valid: bool =
            self.view(planet_owner_storage.verify(planet_id, planet_owner_state));
        assert(planet_owner_valid, "Planet owner is not valid");

        let mut new_planet_owner_state = planet_owner_state;
        new_planet_owner_state.owner = new_owner;
        self.call(planet_owner_storage.set(planet_id, new_planet_owner_state));
    }

    #[external("public")]
    fn deduct_score(player_address: AztecAddress, player_state: Player, amount: u128) {
        self.internal.assert_admin();
        let player_storage = PlayerStorage::at(player_address);

        let is_initialized = self.view(player_storage.is_initialized(player_address));
        assert(is_initialized, "Player is not initialized");

        let player_valid: bool = self.view(player_storage.verify(player_address, player_state));
        assert(player_valid, "Player is not valid");

        assert(amount <= player_state.score, "tried to deduct much score");

        let mut new_player_state = player_state;
        new_player_state.score -= amount;
        self.call(player_storage.set(player_address, new_player_state));
    }

    #[external("public")]
    fn add_score(player_address: AztecAddress, player_state: Player, amount: u128) {
        self.internal.assert_admin();
        let player_storage = PlayerStorage::at(player_address);

        let is_initialized = self.view(player_storage.is_initialized(player_address));
        assert(is_initialized, "Player is not initialized");

        let player_valid: bool = self.view(player_storage.verify(player_address, player_state));
        assert(player_valid, "Player is not valid");

        let mut new_player_state = player_state;
        new_player_state.score += amount;
        self.call(player_storage.set(player_address, new_player_state));
    }

}
