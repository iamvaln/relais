// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {RelaisDms} from "../src/RelaisDms.sol";

/// Joue des séquences aléatoires d'appels, valides ou non, sur un sujet, et note ce que
/// le contrat a accepté. Les invariants sont vérifiés après chaque appel.
contract Handler is Test {
    uint64 internal constant DAY = 1 days;

    RelaisDms public dms;
    address public operator;
    bytes32 public pk = keccak256("pk");
    bytes32 public subject = keccak256(abi.encodePacked(pk));
    bytes internal sig = new bytes(64);

    uint64 public lastDue;
    bool public dueDecreased;
    bool public triggerMismatch;
    uint256 public triggers;
    uint256 public accepted;

    constructor(RelaisDms dms_, address operator_) {
        dms = dms_;
        operator = operator_;
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 200 days));
    }

    function register(uint8 n, uint8 m, uint32 silence, uint32 freq, uint16 dueDays) external {
        vm.prank(operator);
        try dms.register(subject, pk, n, m, silence, freq, _day(dueDays), sig) {
            accepted++;
        } catch {}
        _track();
    }

    function checkin(uint16 dueDays) external {
        vm.prank(operator);
        try dms.checkin(subject, _day(dueDays), sig) {
            accepted++;
        } catch {}
        _track();
    }

    function pause(uint16 untilDays) external {
        vm.prank(operator);
        try dms.pause(subject, _day(untilDays), sig) {
            accepted++;
        } catch {}
        _track();
    }

    function resume(uint16 dueDays) external {
        vm.prank(operator);
        try dms.resume(subject, _day(dueDays), sig) {
            accepted++;
        } catch {}
        _track();
    }

    function trigger(address by) external {
        bool can = dms.triggerable(subject);
        vm.prank(by);
        try dms.trigger(subject) {
            if (!can) triggerMismatch = true;
            triggers++;
        } catch {
            if (can) triggerMismatch = true;
        }
        _track();
    }

    function cancelTrigger(uint16 dueDays) external {
        vm.prank(operator);
        try dms.cancelTrigger(subject, _day(dueDays), sig) {
            accepted++;
        } catch {}
        _track();
    }

    function complete() external {
        vm.prank(operator);
        try dms.complete(subject) {
            accepted++;
        } catch {}
        _track();
    }

    function deactivate() external {
        vm.prank(operator);
        try dms.deactivate(subject, sig) {
            accepted++;
        } catch {}
        _track();
    }

    function setPointers(uint8 count) external {
        bytes32[] memory packs = new bytes32[](count % 8);
        vm.prank(operator);
        try dms.setPointers(subject, packs, keccak256(abi.encode(count))) {} catch {}
    }

    function setShareHashes(uint8 count) external {
        bytes32[] memory hashes = new bytes32[](count % 8);
        vm.prank(operator);
        try dms.setShareHashes(subject, hashes) {} catch {}
    }

    /// Une date alignée au jour, autour de maintenant (passé proche compris, pour tester les refus).
    function _day(uint16 days_) internal view returns (uint64) {
        uint256 today = block.timestamp - (block.timestamp % DAY);
        // sûr : l'horloge des tests reste très en deçà de 2^64 secondes
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(today + uint256(days_) * DAY) - 5 * DAY;
    }

    function _track() internal {
        uint64 due = dms.get(subject).nextCheckinDue;
        if (due < lastDue) dueDecreased = true;
        lastDue = due;
    }
}

contract RelaisDmsInvariantTest is Test {
    RelaisDms internal dms;
    Handler internal handler;
    address internal operator = makeAddr("operator");

    function setUp() public {
        vm.warp(20_000 days);
        dms = new RelaisDms(operator);
        handler = new Handler(dms, operator);
        targetContract(address(handler));
    }

    function invariant_the_due_date_never_decreases() public view {
        assertFalse(handler.dueDecreased());
    }

    function invariant_trigger_succeeds_iff_triggerable() public view {
        assertFalse(handler.triggerMismatch());
    }

    function invariant_status_and_dates_agree() public view {
        RelaisDms.Dms memory d = dms.get(handler.subject());
        assertEq(d.pausedUntil > 0, d.status == RelaisDms.Status.Paused);
        assertEq(d.triggeredAt > 0, d.status == RelaisDms.Status.Triggered);
        if (d.status == RelaisDms.Status.Active || d.status == RelaisDms.Status.Paused) {
            assertGe(d.n, 2);
            assertGe(d.m, d.n);
            assertGt(d.checkinFreqSecs, 0);
            assertGe(d.silenceSecs, 30 days);
            assertEq(d.nextCheckinDue % 1 days, 0);
        }
    }

    function invariant_an_expired_pause_never_blocks_the_timer() public view {
        RelaisDms.Dms memory d = dms.get(handler.subject());
        if (d.status != RelaisDms.Status.Paused) return;
        uint256 at = uint256(d.pausedUntil) + d.checkinFreqSecs + d.silenceSecs;
        assertEq(dms.triggerable(handler.subject()), block.timestamp >= at);
    }

    function invariant_the_timer_only_runs_while_active_or_paused() public view {
        RelaisDms.Dms memory d = dms.get(handler.subject());
        bool running = d.status == RelaisDms.Status.Active || d.status == RelaisDms.Status.Paused;
        assertEq(dms.secondsUntilTriggerable(handler.subject()) != type(uint256).max, running);
    }

    function invariant_pointers_are_bounded_by_the_contact_count() public view {
        RelaisDms.Dms memory d = dms.get(handler.subject());
        (bytes32[] memory packs,) = dms.pointers(handler.subject());
        bytes32[] memory hashes = dms.shareHashes(handler.subject());
        if (d.status == RelaisDms.Status.Inactive || d.status == RelaisDms.Status.Completed) {
            assertEq(packs.length, 0);
            assertEq(hashes.length, 0);
        } else {
            assertLe(packs.length, d.m);
            assertTrue(hashes.length == 0 || hashes.length == d.m);
        }
    }

    function invariant_the_contract_holds_no_ether() public view {
        assertEq(address(dms).balance, 0);
    }
}
