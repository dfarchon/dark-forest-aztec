// Arrival data for planet events

use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct Arrival {
    pub id: Field,
    pub player: AztecAddress,
    pub from_planet: Field,
    pub to_planet: Field,
    pub pop_arriving: u128,
    pub silver_moved: u128,
    pub departure_time: u64,
    pub arrival_time: u64,
    pub arrival_type: u8,
    pub carried_artifact_id: Field,
    pub distance: u128,
}

impl Arrival {
    pub fn zero() -> Self {
        Arrival {
            id: 0,
            player: AztecAddress::zero(),
            from_planet: 0 as Field,
            to_planet: 0 as Field,
            pop_arriving: 0,
            silver_moved: 0,
            departure_time: 0,
            arrival_time: 0,
            arrival_type: 0,
            carried_artifact_id: 0 as Field,
            distance: 0,
        }
    }
}

pub mod ArrivalType {
    pub global Unknown: u8 = 0;
    pub global Normal: u8 = 1;
    pub global Photoid: u8 = 2;
    pub global Wormhole: u8 = 3;
}

pub mod packed {
    use super::Arrival;
    use aztec::protocol::{address::AztecAddress, traits::{FromField, ToField}};
    global PRESENT: Field = 0x100000000000000000000000000000000000000000000000000;
    global COMPACT: Field = 0x20000000000000000000000000000000000000000000000000000000000;
    global TWO32: Field = 0x100000000;
    global TWO64: Field = 0x10000000000000000;
    global TWO128: Field = 0x100000000000000000000000000000000;
    global TWO192: Field = 0x1000000000000000000000000000000000000000000000000;
    global INV_TWO32: Field = 1 / TWO32;
    global INV_TWO64: Field = 0x24d6ba07f7aa8f04b2d8f06f77f52a93ca478dbeab3c92cd2d3e8053e396ee4d;
    global INV_TWO128: Field = 0x133100d71fdf35792b16366f4f7684df54ad7e14a329e70f18ee753c76f9dc6f;

    // The authoritative map key supplies the ID. All contract writes enforce key == state.id.
    // A tagged compact representation covers ordinary values. Larger amounts,
    // distances and times retain the complete original ranges through the full
    // representation; no game input is rejected or truncated to save storage.
    pub fn pack_arrival(a: Arrival) -> [Field; 7] {
        if (a.pop_arriving <= 0xffffffffffffffff)
            & (a.silver_moved <= 0xffffffffffffffff)
            & (a.distance <= 0xffffffff)
            & (a.departure_time <= 0xffffffff)
            & (a.arrival_time <= 0xffffffff) {
            let upper = a.distance as Field
                + TWO32
                    * (
                        a.departure_time as Field
                            + TWO32 * (a.arrival_time as Field + TWO32 * (a.arrival_type as Field))
                    );
            [
                a.player.to_field(),
                a.from_planet,
                a.to_planet,
                a.carried_artifact_id,
                COMPACT
                    + a.pop_arriving as Field
                    + TWO64 * (a.silver_moved as Field)
                    + TWO128 * upper,
                0,
                0,
            ]
        } else {
            [
                a.player.to_field(),
                a.from_planet,
                a.to_planet,
                a.carried_artifact_id,
                PRESENT
                    + a.pop_arriving as Field
                    + (a.departure_time as Field) * TWO128
                    + (a.arrival_type as Field) * TWO192,
                a.silver_moved as Field + (a.arrival_time as Field) * TWO128,
                a.distance as Field,
            ]
        }
    }
    pub fn unpack_arrival(id: Field, p: [Field; 7]) -> Arrival {
        if p == [0; 7] {
            Arrival::zero()
        } else {
            let low = p[4] as u128;
            let upper = (p[4] - low as Field) * INV_TWO128;
            if ((upper as u128 >> 105) & 1) == 1 {
                let population = low as u64;
                let silver = (low >> 64) as u64;
                let distance = upper as u32;
                let departure = (upper - distance as Field) * INV_TWO32;
                let departure_time = departure as u32;
                let arrival = (departure - departure_time as Field) * INV_TWO32;
                let arrival_time = arrival as u32;
                let arrival_type = ((arrival - arrival_time as Field) * INV_TWO32) as u8;
                let a = Arrival {
                    id,
                    player: AztecAddress::from_field(p[0]),
                    from_planet: p[1],
                    to_planet: p[2],
                    carried_artifact_id: p[3],
                    pop_arriving: population as u128,
                    silver_moved: silver as u128,
                    distance: distance as u128,
                    departure_time: departure_time as u64,
                    arrival_time: arrival_time as u64,
                    arrival_type,
                };
                assert_eq(pack_arrival(a), p, "Noncanonical compact arrival");
                a
            } else {
                let numeric = p[4] - PRESENT;
                let population = numeric as u128;
                let upper = (numeric - population as Field) * INV_TWO128;
                let departure_time = upper as u64;
                let arrival_type = ((upper - departure_time as Field) * INV_TWO64) as u8;
                let silver = p[5] as u128;
                let arrival_time = ((p[5] - silver as Field) * INV_TWO128) as u64;
                let distance = p[6] as u128;
                assert_eq(
                    numeric,
                    population as Field
                        + (departure_time as Field) * TWO128
                        + (arrival_type as Field) * TWO192,
                    "Noncanonical packed arrival",
                );
                assert_eq(
                    p[5],
                    silver as Field + (arrival_time as Field) * TWO128,
                    "Noncanonical packed arrival",
                );
                assert_eq(p[6], distance as Field, "Noncanonical packed arrival");
                Arrival {
                    id,
                    player: AztecAddress::from_field(p[0]),
                    from_planet: p[1],
                    to_planet: p[2],
                    carried_artifact_id: p[3],
                    pop_arriving: population,
                    silver_moved: silver,
                    distance,
                    departure_time,
                    arrival_time,
                    arrival_type,
                }
            }
        }
    }
    #[test]
    fn absent_requested_nonzero_id_returns_all_zero() {
        assert_eq(unpack_arrival(-1, [0; 7]), Arrival::zero());
    }
    #[test]
    fn explicit_zero_key_and_value_retains_presence() {
        assert_eq(PRESENT, 2.pow_32(200));
        let p = pack_arrival(Arrival::zero());
        assert_eq(p[4], COMPACT);
        assert_eq(unpack_arrival(0, p), Arrival::zero());
        assert(p != [0; 7]);
    }
    #[test]
    fn nonzero_key_with_other_fields_zero_is_not_absent() {
        let mut a = Arrival::zero();
        a.id = -1;
        assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
    }
    #[test]
    fn full_width_record_round_trip() {
        let a = Arrival {
            id: -1,
            player: AztecAddress::from_field(-2),
            from_planet: -3,
            to_planet: -4,
            carried_artifact_id: -5,
            pop_arriving: 0xffffffffffffffffffffffffffffffff,
            silver_moved: 0xffffffffffffffffffffffffffffffff,
            distance: 0xffffffffffffffffffffffffffffffff,
            departure_time: 0xffffffffffffffff,
            arrival_time: 0xffffffffffffffff,
            arrival_type: 0xff,
        };
        assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
    }
    #[test(should_fail)]
    fn rejects_nonzero_record_without_presence() {
        let mut p = [0; 7];
        p[0] = 1;
        unpack_arrival(9, p);
    }
    #[test(should_fail)]
    fn rejects_reserved_numeric_high_bit() {
        let mut p = [0; 7];
        p[4] = PRESENT + PRESENT;
        unpack_arrival(9, p);
    }
    #[test(should_fail)]
    fn rejects_overwide_time_word() {
        let mut p = [0; 7];
        p[4] = PRESENT;
        p[5] = TWO192;
        unpack_arrival(9, p);
    }
    #[test(should_fail)]
    fn rejects_overwide_distance() {
        let mut p = [0; 7];
        p[4] = PRESENT;
        p[6] = TWO128;
        unpack_arrival(9, p);
    }
    #[test]
    fn zero_id_retains_nonzero_state() {
        let mut a = Arrival::zero();
        a.player = AztecAddress::from_field(-1);
        a.pop_arriving = 23;
        assert_eq(unpack_arrival(0, pack_arrival(a)), a);
    }
    #[test]
    fn compact_boundaries_and_full_width_fallback() {
        assert_eq(COMPACT, 2.pow_32(233));
        assert_eq(INV_TWO32 * TWO32, 1);
        assert_eq(INV_TWO64 * TWO64, 1);
        let mut a = Arrival::zero();
        a.id = -1;
        a.player = AztecAddress::from_field(-2);
        a.from_planet = -3;
        a.to_planet = -4;
        a.carried_artifact_id = -5;
        a.pop_arriving = 0xffffffffffffffff;
        a.silver_moved = 0xffffffffffffffff;
        a.distance = 0xffffffff;
        a.departure_time = 0xffffffff;
        a.arrival_time = 0xffffffff;
        a.arrival_type = 255;
        let packed = pack_arrival(a);
        assert_eq(packed[5], 0);
        assert_eq(packed[6], 0);
        assert_eq(unpack_arrival(a.id, packed), a);
        a.pop_arriving += 1;
        assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
        a.silver_moved += 1;
        assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
        a.distance += 1;
        assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
        a.departure_time += 1;
        assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
        a.arrival_time += 1;
        assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
    }
    #[test(should_fail_with = "Noncanonical compact arrival")]
    fn rejects_compact_reserved_word() {
        let mut p = pack_arrival(Arrival::zero());
        p[5] = 1;
        unpack_arrival(0, p);
    }
    #[test(should_fail_with = "Noncanonical compact arrival")]
    fn rejects_compact_reserved_bit() {
        let mut p = pack_arrival(Arrival::zero());
        p[4] += 0x10000000000000000000000000000000000000000000000000000000000;
        unpack_arrival(0, p);
    }
    #[test]
    unconstrained fn every_numeric_bit_round_trips() {
        for bit in 0..128 {
            let mut a = Arrival::zero();
            a.id = -1;
            let value = 2.pow_32(bit as Field) as u128;
            a.pop_arriving = value;
            assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
            a.silver_moved = value;
            assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
            a.distance = value;
            assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
        }
        for bit in 0..64 {
            let mut a = Arrival::zero();
            a.id = -1;
            let value = 2.pow_32(bit as Field) as u64;
            a.departure_time = value;
            assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
            a.arrival_time = value;
            assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
        }
        for bit in 0..8 {
            let mut a = Arrival::zero();
            a.arrival_type = 2.pow_32(bit as Field) as u8;
            assert_eq(unpack_arrival(a.id, pack_arrival(a)), a);
        }
    }
}
