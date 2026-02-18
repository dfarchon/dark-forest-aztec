use dep::aztec::macros::aztec;

#[aztec]
contract PlanetUpgrade {
    use dep::aztec::{
        macros::{functions::{external, initializer, internal}, storage::storage},
        protocol_types::address::AztecAddress,
    };
    use dep::aztec::state_vars::PublicMutable;

    use dep::config::Config;
    use dep::libs::lazy_update::light_refresh_resources;
    use dep::libs::planet::{apply_upgrade, calculate_upgrade_cost, validate_upgrade};
    use dep::planet_caps_storage::PlanetCapsStorage;
    use dep::planet_events_storage::PlanetEventsStorage;
    use dep::planet_mods_storage::PlanetModsStorage;
    use dep::planet_owner_storage::PlanetOwnerStorage;
    use dep::planet_resources_storage::PlanetResourcesStorage;

    use dep::types::storage::{PlanetCaps, PlanetEvents, PlanetMods, PlanetOwner, PlanetResources};

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        config_storage_address: PublicMutable<AztecAddress, Context>,
        planet_owner_storage_address: PublicMutable<AztecAddress, Context>,
        planet_caps_storage_address: PublicMutable<AztecAddress, Context>,
        planet_resources_storage_address: PublicMutable<AztecAddress, Context>,
        planet_events_storage_address: PublicMutable<AztecAddress, Context>,
        planet_mods_storage_address: PublicMutable<AztecAddress, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
    }

    #[internal("public")]
    fn assert_admin() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
    }

    #[internal("public")]
    fn get_config_storage_address() -> AztecAddress {
        self.storage.config_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_owner_storage_address() -> AztecAddress {
        self.storage.planet_owner_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_caps_storage_address() -> AztecAddress {
        self.storage.planet_caps_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_resources_storage_address() -> AztecAddress {
        self.storage.planet_resources_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_events_storage_address() -> AztecAddress {
        self.storage.planet_events_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_mods_storage_address() -> AztecAddress {
        self.storage.planet_mods_storage_address.read()
    }

    #[external("public")]
    fn transfer_admin(new_admin: AztecAddress) {
        self.internal.assert_admin();
        self.storage.admin.write(new_admin);
    }

    #[external("public")]
    fn set_config_storage_address(config_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.config_storage_address.write(config_storage_address);
    }

    #[external("public")]
    fn set_planet_owner_storage_address(planet_owner_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_owner_storage_address.write(planet_owner_storage_address);
    }

    #[external("public")]
    fn set_planet_caps_storage_address(planet_caps_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_caps_storage_address.write(planet_caps_storage_address);
    }

    #[external("public")]
    fn set_planet_resources_storage_address(planet_resources_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_resources_storage_address.write(planet_resources_storage_address);
    }

    #[external("public")]
    fn set_planet_events_storage_address(planet_events_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_events_storage_address.write(planet_events_storage_address);
    }

    #[external("public")]
    fn set_planet_mods_storage_address(planet_mods_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_mods_storage_address.write(planet_mods_storage_address);
    }

    #[internal("public")]
    fn upgrade_planet_internal(
        location: Field,
        defense_upgrades: u8,
        range_upgrades: u8,
        speed_upgrades: u8,
        planet_owner_state: PlanetOwner,
        planet_caps_state: PlanetCaps,
        planet_resources_state: PlanetResources,
        planet_events_state: PlanetEvents,
        planet_mods_state: PlanetMods,
    ) {
        let planet_owner_storage = PlanetOwnerStorage::at(
            self.internal.get_planet_owner_storage_address(),
        );
        let planet_caps_storage = PlanetCapsStorage::at(
            self.internal.get_planet_caps_storage_address(),
        );
        let planet_resources_storage = PlanetResourcesStorage::at(
            self.internal.get_planet_resources_storage_address(),
        );
        let planet_events_storage = PlanetEventsStorage::at(
            self.internal.get_planet_events_storage_address(),
        );
        let planet_mods_storage = PlanetModsStorage::at(
            self.internal.get_planet_mods_storage_address(),
        );

        let planet_owner_is_valid: bool =
            self.view(planet_owner_storage.verify(location, planet_owner_state));
        let planet_caps_is_valid: bool =
            self.view(planet_caps_storage.verify(location, planet_caps_state));
        let planet_resources_is_valid: bool =
            self.view(planet_resources_storage.verify(location, planet_resources_state));
        let planet_events_is_valid: bool =
            self.view(planet_events_storage.verify(location, planet_events_state));
        let planet_mods_is_valid: bool =
            self.view(planet_mods_storage.verify(location, planet_mods_state));

        assert(planet_owner_is_valid, "Planet owner is not valid");
        assert(planet_caps_is_valid, "Planet caps is not valid");
        assert(planet_resources_is_valid, "Planet resources is not valid");
        assert(planet_events_is_valid, "Planet events is not valid");
        assert(planet_mods_is_valid, "Planet mods is not valid");

        // Upgrade must run on a fresh state with no due arrivals/events.
        // Future events are allowed, but anything due now or in the past
        // must be processed by Core.refresh_planet_public first.
        let current_timestamp = self.context.timestamp();
        for i in 0..planet_events_state.events_count {
            assert(
                planet_events_state.events[i].time_trigger > current_timestamp,
                "Planet has pending due events",
            );
        }

        let refreshed_resources = light_refresh_resources(
            self.context.timestamp(),
            planet_owner_state,
            planet_caps_state,
            planet_resources_state,
            planet_mods_state,
        );

        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        let upgrade_config = self.view(config.get_upgrade_config_public());
        let upgrades = self.view(config.get_all_upgrades_public());

        validate_upgrade(
            planet_owner_state,
            refreshed_resources,
            self.msg_sender().unwrap(),
            defense_upgrades,
            range_upgrades,
            speed_upgrades,
            upgrade_config,
        );

        let silver_cost = calculate_upgrade_cost(
            refreshed_resources,
            planet_caps_state,
            defense_upgrades,
            range_upgrades,
            speed_upgrades,
            upgrade_config,
        );

        let (next_planet_caps_state, next_planet_resources_state) = apply_upgrade(
            planet_caps_state,
            refreshed_resources,
            defense_upgrades,
            range_upgrades,
            speed_upgrades,
            upgrades,
            silver_cost,
        );

        self.call(planet_caps_storage.set(location, next_planet_caps_state));
        self.call(planet_resources_storage.set(location, next_planet_resources_state));
    }

    #[external("public")]
    fn upgrade_planet(
        location: Field,
        defense_upgrades: u8,
        range_upgrades: u8,
        speed_upgrades: u8,
        planet_owner_state: PlanetOwner,
        planet_caps_state: PlanetCaps,
        planet_resources_state: PlanetResources,
        planet_events_state: PlanetEvents,
        planet_mods_state: PlanetMods,
    ) {
        self.internal.upgrade_planet_internal(
            location,
            defense_upgrades,
            range_upgrades,
            speed_upgrades,
            planet_owner_state,
            planet_caps_state,
            planet_resources_state,
            planet_events_state,
            planet_mods_state,
        );
    }
}
