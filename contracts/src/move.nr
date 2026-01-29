




     // ========== DFMoveFacet ==========
     #[event]
    struct ArrivalQueued {
        player: AztecAddress,
        arrival_id: u128,
        from: Field,
        to: Field,
        artifact_id: u128,
        abandoning: u128,
    }



    /// Noir port of Solidity `DFMoveFacet.move`.
    /// Private function that verifies ZK proof for a move.
    /// 
    /// This function:
    /// 1. Verifies the move ZK proof using move_proof circuit
    /// 2. Validates SNARK perlin flags
    /// 3. Enqueues the public move function
    /// 
    /// # Arguments
    /// - `old_loc`: Expected source planet location ID
    /// - `new_loc`: Expected destination planet location ID  
    /// - `new_perlin`: Expected perlin value at destination
    /// - `new_radius`: Radius of destination from origin
    /// - `max_dist`: Maximum distance allowed
    /// - `x1`, `y1`: Source planet coordinates (private)
    /// - `x2`, `y2`: Destination planet coordinates (private)
    /// - `pop_moved`: Population to move
    /// - `silver_moved`: Silver to move
    /// - `moved_artifact_id`: Artifact ID being moved (0 if none)
    /// - `is_abandoning`: Whether abandoning the planet (0 or 1)
    /// - `planet_hash_key`: Planet hash key for proof
    /// - `space_type_key`: Space type key for proof
    /// - `scale`: Perlin scale
    /// - `x_mirror`: X mirror flag
    /// - `y_mirror`: Y mirror flag
    #[external("private")]
    fn move_private(
        old_loc: Field,
        new_loc: Field,
        new_perlin: u8,
        new_radius: u128,
        max_dist: u128,
        x1: Field,
        y1: Field,
        x2: Field,
        y2: Field,
        pop_moved: u128,
        silver_moved: u128,
        moved_artifact_id: u128,
        is_abandoning: u128,
        planet_hash_key: u128,
        space_type_key: u128,
        biomebase_key: u128,
        scale: u128,
        x_mirror: bool,
        y_mirror: bool,
    ) {
        let snark_constants = self.storage.snark_constants.read();
        
        // Validate SNARK perlin flags
        let _ = self.internal.revert_if_bad_snark_perlin_flags(
            planet_hash_key,
            space_type_key,
            biomebase_key,
            x_mirror,
            y_mirror,
            scale,
            false, // checking_biome = false
        );
        
        // Verify ZK proof if checks are enabled
        if !snark_constants.disable_zk_checks {
            let r = new_radius as Field;
            let dist_max = max_dist as Field;
            let (computed_old_loc, computed_new_loc, computed_perlin) = move_proof(
                r,
                dist_max,
                planet_hash_key as Field,
                space_type_key as Field,
                scale,
                x_mirror,
                y_mirror,
                x1,
                y1,
                x2,
                y2,
            );
            
            assert(computed_old_loc == old_loc, "Source planet hash mismatch");
            assert(computed_new_loc == new_loc, "Destination planet hash mismatch");
            assert(computed_perlin == new_perlin, "Perlin value mismatch");
        }
        
        // Enqueue public function
        self.enqueue_self.pub_move(
            old_loc,
            new_loc,
            new_perlin,
            new_radius,
            max_dist,
            pop_moved,
            silver_moved,
            moved_artifact_id,
            is_abandoning,
        );
    }

    /// Public function that executes the move and updates state.
    /// 
    /// This function:
    /// 1. Checks game is not paused
    /// 2. Validates radius bounds
    /// 3. Refreshes origin planet
    /// 4. Initializes or refreshes destination planet
    /// 5. Executes the move logic
    /// 6. Updates world radius
    /// 7. Emits ArrivalQueued event
    /// 
    /// # Arguments
    /// - `old_loc`: Source planet location ID
    /// - `new_loc`: Destination planet location ID
    /// - `new_perlin`: Perlin value at destination
    /// - `new_radius`: Radius of destination from origin
    /// - `max_dist`: Maximum distance allowed
    /// - `pop_moved`: Population to move
    /// - `silver_moved`: Silver to move
    /// - `moved_artifact_id`: Artifact ID being moved (0 if none)
    /// - `is_abandoning`: Whether abandoning the planet (0 or 1)
    /// 
    /// # Returns
    /// The arrival event ID
    #[external("public")]
    #[only_self]
    fn pub_move(
        old_loc: Field,
        new_loc: Field,
        new_perlin: u8,
        new_radius: u128,
        max_dist: u128,
        pop_moved: u128,
        silver_moved: u128,
        moved_artifact_id: u128,
        is_abandoning: u128,
    ) -> u128 {
        // Check game is not paused
        assert(!self.storage.paused.read(), "Game is paused");
        
        // Check radius bounds
        let world_radius = self.storage.world_radius.read();
        assert(new_radius <= world_radius, "Attempting to move out of bounds");
        
        // Get sender
        let sender = self.msg_sender().unwrap();
        
        // Build move args
        let args = DFPMoveArgs {
            old_loc,
            new_loc,
            max_dist,
            pop_moved,
            silver_moved,
            moved_artifact_id,
            abandoning: is_abandoning,
            sender,
        };
        
        // Refresh origin planet first
        let timestamp = self.context.timestamp();
        self.internal.refresh_planet(old_loc, timestamp);
        
        // Increment planet events count
        let events_count = self.storage.planet_events_count.read();
        self.storage.planet_events_count.write(events_count + 1);
        
        // Initialize or refresh destination planet
        let dest_planet = self.storage.planets.at(new_loc).read();
        if !dest_planet.is_initialized {
            self.internal.initialize_planet_with_defaults(new_loc, new_perlin, false, timestamp);
        } else {
            self.internal.refresh_planet(new_loc, timestamp);
            self.internal.check_planet_dos(new_loc, sender);
        }
        
        // Execute move
        self.internal.execute_move_internal(args, new_perlin, timestamp);
        
        // Update world radius
        self.internal.update_world_radius();
        
        // Get final events count for event emission
        let arrival_id = self.storage.planet_events_count.read();
        
        // Emit event
        self.emit(ArrivalQueued {
            player: sender,
            arrival_id,
            from: old_loc,
            to: new_loc,
            artifact_id: moved_artifact_id,
            abandoning: is_abandoning,
        });
        
        arrival_id
    }




use crate::types::{
    PlanetDefaultStats, Upgrade, Planet, RevealedCoords, Player,
    ArrivalData, Artifact, PlanetEventMetadata, DFPInitPlanetArgs,
    AdminCreatePlanetArgs, DFPMoveArgs, DFPCreateArrivalArgs,
};

use crate::libraries::game_utils::{
    calculate_byte_uint_from_location_id,
    is_pop_cap_boost,
    is_pop_gro_boost,
    is_range_boost,
    is_speed_boost,
    is_def_boost,
    is_half_space_junk,
};
use crate::libraries::lazy_update::{apply_pending_events, update_planet};
use crate::libraries::planet::apply_spaceship_arrive;
use crate::circuits::init::init_proof;
use crate::circuits::reveal::reveal_proof;
use crate::circuits::move::move_proof;
