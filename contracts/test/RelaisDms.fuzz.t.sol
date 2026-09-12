// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {RelaisDms} from "../src/RelaisDms.sol";

/// Propriétés sur des entrées aléatoires (docs/smart-contract-v2.md §6).
contract RelaisDmsFuzzTest is Test {
    uint64 internal constant DAY = 1 days;
    uint32 internal constant FREQ = 30 days;
    uint32 internal constant SILENCE = 90 days;

    address internal operator = makeAddr("operator");
    bytes32 internal pk = keccak256("pk");
    bytes32 internal subject = keccak256(abi.encodePacked(pk));
    bytes internal sig = new bytes(64);
    RelaisDms internal dms;
    uint64 internal t0 = 20_000 * DAY;

    function setUp() public {
        vm.warp(t0);
        dms = new RelaisDms(operator);
    }

    function testFuzz_secondsUntilTriggerable_counts_down_to_zero(uint32 dt) public {
        vm.prank(operator);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + FREQ, sig);
        vm.warp(uint256(t0) + dt);
        uint256 at = uint256(t0) + FREQ + SILENCE;
        uint256 expected = block.timestamp >= at ? 0 : at - block.timestamp;
        assertEq(dms.secondsUntilTriggerable(subject), expected);
        assertEq(dms.triggerable(subject), expected == 0);
    }

    function testFuzz_register_accepts_exactly_the_documented_parameters(
        uint8 n,
        uint8 m,
        uint32 silenceSecs,
        uint32 freqSecs,
        uint64 nextDue,
        uint8 sigLen
    ) public {
        bool valid = n >= 2 && m >= n && freqSecs > 0 && silenceSecs >= 30 days
            && nextDue % DAY == 0 && nextDue > t0 && sigLen == 64;
        vm.prank(operator);
        try dms.register(subject, pk, n, m, silenceSecs, freqSecs, nextDue, new bytes(sigLen)) {
            assertTrue(valid, "accepted invalid parameters");
            assertEq(uint8(dms.get(subject).status), uint8(RelaisDms.Status.Active));
        } catch {
            assertFalse(valid, "rejected valid parameters");
        }
    }

    function testFuzz_pause_accepts_a_day_aligned_end_within_a_year(uint64 until) public {
        vm.prank(operator);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + FREQ, sig);
        bool valid = until % DAY == 0 && until > t0 && until <= t0 + 365 days;
        vm.prank(operator);
        try dms.pause(subject, until, sig) {
            assertTrue(valid, "accepted a bad pause end");
            assertEq(dms.get(subject).pausedUntil, until);
        } catch {
            assertFalse(valid, "rejected a good pause end");
        }
    }

    function testFuzz_checkin_only_moves_forward_by_whole_days(uint64 nextDue) public {
        vm.prank(operator);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + FREQ, sig);
        bool valid = nextDue % DAY == 0 && nextDue > t0 + FREQ;
        vm.prank(operator);
        try dms.checkin(subject, nextDue, sig) {
            assertTrue(valid, "accepted a non increasing due date");
        } catch {
            assertFalse(valid, "rejected an increasing due date");
        }
        assertGe(dms.get(subject).nextCheckinDue, t0 + FREQ);
    }
}
