use dep::aztec::macros::aztec;

#[aztec]
pub contract Main {
    use dep::aztec::{
        macros::{events::event, functions::{external, initializer}, storage::storage},
        protocol_types::{address::AztecAddress, traits::{Deserialize, Packable, Serialize}},
    };
    use dep::aztec::state_vars::{Map, PublicMutable};
    use dep::std::meta::derive;

    #[derive(Serialize, Deserialize, Packable)]
    pub struct Planet {
        owner: AztecAddress,
        x: u128,
        y: u128,
    }

    #[derive(Serialize, Deserialize, Packable)]
    pub struct PlanetBatch {
        planets: [Planet; 1000],
        count: u128,
    }

    #[storage]
    struct Storage<Context> {
        // The admin of the contract
        admin: PublicMutable<AztecAddress, Context>,
        planets: Map<u128, PublicMutable<Planet, Context>, Context>,
        planet_count: PublicMutable<u128, Context>,
    }

    #[event]
    pub struct ValueUpdated {
        pub value: Field,
        pub updater: AztecAddress,
        pub timestamp: u64,
    }

    #[event]
    pub struct MessageEmitted {
        pub message: Field,
        pub sender: AztecAddress,
    }

    #[external("public")]
    #[initializer]
    // annotation to mark function as a constructor
    fn constructor() {
        self.storage.admin.write(self.msg_sender().unwrap());
    }

    #[external("public")]
    fn emit_value_update(value: Field) {
        let sender = self.msg_sender().unwrap();
        let timestamp = self.context.timestamp();

        // Emit public event
        self.emit(ValueUpdated { value, updater: sender, timestamp });
    }

    #[external("private")]
    fn sercet_call() {
        self.enqueue_self.emit_value_update(123);
    }

    #[external("public")]
    fn create_planet() {
        let sender = self.msg_sender().unwrap();
        let planet = Planet { owner: sender, x: 0, y: 0 };
        let planet_id = self.storage.planet_count.read();
        // Map: use .at(key).write(value) to write
        self.storage.planets.at(planet_id).write(planet);
        self.storage.planet_count.write(planet_id + 1);
    }

    #[external("utility")]
    unconstrained fn get_planet(planet_id: u128) -> Planet {
        self.storage.planets.at(planet_id).read()
    }

    #[external("utility")]
    unconstrained fn get_planet_count() -> u128 {
        self.storage.planet_count.read()
    }

    #[external("utility")]
    unconstrained fn bulk_get_planets(start_idx: u128, end_idx: u128) -> PlanetBatch {
        let total = self.storage.planet_count.read();
        assert(end_idx <= total);
        assert(start_idx <= end_idx);

        let n = end_idx - start_idx;
        assert(n <= 1000);

        let dummy = Planet { owner: AztecAddress::zero(), x: 0, y: 0 };
        let mut arr = [dummy; 1000];

        let mut i: u128 = 0;
        while i < n {
            let pid = start_idx + i;
            arr[i as u32] = self.storage.planets.at(pid).read();
            i += 1;
        }

        PlanetBatch { planets: arr, count: n }
    }
}