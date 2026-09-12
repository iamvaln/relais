// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {RelaisDms} from "../src/RelaisDms.sol";

/// Machine à états du minuteur public (docs/smart-contract-v2.md §1 et §2).
contract RelaisDmsTest is Test {
    uint64 internal constant DAY = 1 days;
    uint32 internal constant FREQ = 30 days;
    uint32 internal constant SILENCE = 90 days;

    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");
    bytes32 internal pk = keccak256("ed25519 public key of the owner");
    bytes32 internal subject = keccak256(abi.encodePacked(pk));
    bytes internal sig = new bytes(64);

    RelaisDms internal dms;
    uint64 internal t0; // aligné au jour

    function setUp() public {
        t0 = 20_000 * DAY; // 2024-10-04, aligné au jour
        vm.warp(t0);
        dms = new RelaisDms(operator);
    }

    function registerDefault() internal {
        vm.prank(operator);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + FREQ, sig);
    }

    // ---------------------------------------------------------------- register

    function test_register_activates_with_the_given_parameters() public {
        registerDefault();
        RelaisDms.Dms memory d = dms.get(subject);
        assertEq(uint8(d.status), uint8(RelaisDms.Status.Active));
        assertEq(d.n, 2);
        assertEq(d.m, 3);
        assertEq(d.silenceSecs, SILENCE);
        assertEq(d.checkinFreqSecs, FREQ);
        assertEq(d.nextCheckinDue, t0 + FREQ);
        assertEq(d.pausedUntil, 0);
        assertEq(d.triggeredAt, 0);
        assertEq(d.ed25519Pk, pk);
    }

    function test_register_emits_Registered_with_the_owner_signature() public {
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.Registered(subject, pk, 2, 3, SILENCE, FREQ, t0 + FREQ, sig);
        registerDefault();
    }

    function test_register_rejects_a_caller_that_is_not_the_operator() public {
        vm.prank(stranger);
        vm.expectRevert(RelaisDms.NotOperator.selector);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + FREQ, sig);
    }

    function test_register_rejects_a_subject_that_is_not_the_hash_of_the_key() public {
        vm.prank(operator);
        vm.expectRevert(RelaisDms.SubjectMismatch.selector);
        dms.register(keccak256("other"), pk, 2, 3, SILENCE, FREQ, t0 + FREQ, sig);
    }

    function test_register_rejects_an_already_active_subject() public {
        registerDefault();
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + 2 * FREQ, sig);
    }

    function test_register_rejects_bad_thresholds_and_durations() public {
        vm.startPrank(operator);
        vm.expectRevert(RelaisDms.BadThreshold.selector);
        dms.register(subject, pk, 1, 3, SILENCE, FREQ, t0 + FREQ, sig); // n < 2
        vm.expectRevert(RelaisDms.BadThreshold.selector);
        dms.register(subject, pk, 3, 2, SILENCE, FREQ, t0 + FREQ, sig); // m < n
        vm.expectRevert(RelaisDms.BadDuration.selector);
        dms.register(subject, pk, 2, 3, SILENCE, 0, t0 + FREQ, sig); // freq = 0
        vm.expectRevert(RelaisDms.BadDuration.selector);
        dms.register(subject, pk, 2, 3, 30 days - 1, FREQ, t0 + FREQ, sig); // silence < 30 j
        vm.stopPrank();
    }

    function test_register_rejects_a_due_date_that_is_not_day_aligned_or_in_the_past() public {
        vm.startPrank(operator);
        vm.expectRevert(RelaisDms.BadDueDate.selector);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + FREQ + 1, sig); // pas aligné
        vm.expectRevert(RelaisDms.BadDueDate.selector);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0, sig); // pas dans le futur
        vm.stopPrank();
    }

    function test_register_rejects_a_signature_that_is_not_64_bytes() public {
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadSignature.selector);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + FREQ, new bytes(63));
    }

    // ---------------------------------------------------------------- checkin

    function test_checkin_moves_the_due_date_forward_and_emits_the_signature() public {
        registerDefault();
        vm.warp(t0 + 10 * DAY);
        vm.prank(operator);
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.CheckedIn(subject, t0 + 10 * DAY + FREQ, sig);
        dms.checkin(subject, t0 + 10 * DAY + FREQ, sig);
        assertEq(dms.get(subject).nextCheckinDue, t0 + 10 * DAY + FREQ);
        assertEq(uint8(dms.get(subject).status), uint8(RelaisDms.Status.Active));
    }

    function test_checkin_never_moves_the_due_date_backward_or_in_place() public {
        registerDefault();
        vm.startPrank(operator);
        vm.expectRevert(RelaisDms.BadDueDate.selector);
        dms.checkin(subject, t0 + FREQ, sig); // égal
        vm.expectRevert(RelaisDms.BadDueDate.selector);
        dms.checkin(subject, t0 + FREQ - DAY, sig); // recule
        vm.stopPrank();
    }

    function test_checkin_requires_the_operator_and_an_active_or_paused_subject() public {
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.checkin(subject, t0 + FREQ, sig); // Inactive
        registerDefault();
        vm.prank(stranger);
        vm.expectRevert(RelaisDms.NotOperator.selector);
        dms.checkin(subject, t0 + 2 * FREQ, sig);
    }

    function test_checkin_during_a_pause_resumes() public {
        registerDefault();
        vm.startPrank(operator);
        dms.pause(subject, t0 + 20 * DAY, sig);
        dms.checkin(subject, t0 + 2 * FREQ, sig);
        vm.stopPrank();
        RelaisDms.Dms memory d = dms.get(subject);
        assertEq(uint8(d.status), uint8(RelaisDms.Status.Active));
        assertEq(d.pausedUntil, 0);
        assertEq(d.nextCheckinDue, t0 + 2 * FREQ);
    }

    // ---------------------------------------------------------------- pause / resume

    function test_pause_sets_pausedUntil_and_keeps_the_due_date() public {
        registerDefault();
        vm.prank(operator);
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.Paused(subject, t0 + 20 * DAY, sig);
        dms.pause(subject, t0 + 20 * DAY, sig);
        RelaisDms.Dms memory d = dms.get(subject);
        assertEq(uint8(d.status), uint8(RelaisDms.Status.Paused));
        assertEq(d.pausedUntil, t0 + 20 * DAY);
        assertEq(d.nextCheckinDue, t0 + FREQ);
    }

    function test_pause_rejects_a_bad_end_date_or_a_subject_not_active() public {
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.pause(subject, t0 + 20 * DAY, sig); // Inactive
        registerDefault();
        vm.startPrank(operator);
        vm.expectRevert(RelaisDms.BadPauseDate.selector);
        dms.pause(subject, t0, sig); // pas dans le futur
        vm.expectRevert(RelaisDms.BadPauseDate.selector);
        dms.pause(subject, t0 + 20 * DAY + 1, sig); // pas aligné
        vm.expectRevert(RelaisDms.BadPauseDate.selector);
        dms.pause(subject, t0 + 366 * DAY, sig); // au-delà d'un an
        dms.pause(subject, t0 + 365 * DAY, sig); // la limite passe
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.pause(subject, t0 + 30 * DAY, sig); // déjà en pause
        vm.stopPrank();
    }

    function test_resume_reactivates_with_a_new_due_date() public {
        registerDefault();
        vm.startPrank(operator);
        dms.pause(subject, t0 + 20 * DAY, sig);
        vm.expectRevert(RelaisDms.BadDueDate.selector);
        dms.resume(subject, t0 + FREQ, sig); // ne recule pas
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.Resumed(subject, t0 + 2 * FREQ, sig);
        dms.resume(subject, t0 + 2 * FREQ, sig);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.resume(subject, t0 + 3 * FREQ, sig); // plus en pause
        vm.stopPrank();
        RelaisDms.Dms memory d = dms.get(subject);
        assertEq(uint8(d.status), uint8(RelaisDms.Status.Active));
        assertEq(d.pausedUntil, 0);
        assertEq(d.nextCheckinDue, t0 + 2 * FREQ);
    }

    // ---------------------------------------------------------------- triggerable

    function test_triggerable_is_false_before_the_silence_elapsed_and_true_after() public {
        registerDefault();
        assertFalse(dms.triggerable(subject));
        assertEq(dms.secondsUntilTriggerable(subject), FREQ + SILENCE);
        vm.warp(t0 + FREQ + SILENCE - 1);
        assertFalse(dms.triggerable(subject));
        assertEq(dms.secondsUntilTriggerable(subject), 1);
        vm.warp(t0 + FREQ + SILENCE);
        assertTrue(dms.triggerable(subject));
        assertEq(dms.secondsUntilTriggerable(subject), 0);
    }

    function test_triggerable_is_never_true_for_an_unregistered_subject() public {
        assertFalse(dms.triggerable(subject));
        assertEq(dms.secondsUntilTriggerable(subject), type(uint256).max);
        vm.warp(t0 + 10_000 * DAY);
        assertFalse(dms.triggerable(subject));
    }

    function test_an_expired_pause_does_not_block_the_timer() public {
        registerDefault();
        uint64 until = t0 + 20 * DAY;
        vm.prank(operator);
        dms.pause(subject, until, sig);
        // pendant la pause : jamais déclenchable, même très loin après l'échéance d'origine
        vm.warp(until - 1);
        assertFalse(dms.triggerable(subject));
        assertEq(dms.secondsUntilTriggerable(subject), FREQ + SILENCE + 1);
        // après la pause : l'échéance est pausedUntil + freq, puis le silence
        vm.warp(until + FREQ + SILENCE - 1);
        assertFalse(dms.triggerable(subject));
        vm.warp(until + FREQ + SILENCE);
        assertTrue(dms.triggerable(subject));
        assertEq(uint8(dms.get(subject).status), uint8(RelaisDms.Status.Paused));
    }

    // ---------------------------------------------------------------- trigger

    function test_anyone_can_trigger_once_the_silence_elapsed() public {
        registerDefault();
        vm.warp(t0 + FREQ + SILENCE);
        vm.prank(stranger);
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.Triggered(subject, t0 + FREQ + SILENCE, stranger);
        dms.trigger(subject);
        RelaisDms.Dms memory d = dms.get(subject);
        assertEq(uint8(d.status), uint8(RelaisDms.Status.Triggered));
        assertEq(d.triggeredAt, t0 + FREQ + SILENCE);
        assertFalse(dms.triggerable(subject));
        assertEq(dms.secondsUntilTriggerable(subject), type(uint256).max);
    }

    function test_trigger_reverts_while_not_triggerable() public {
        registerDefault();
        vm.warp(t0 + FREQ + SILENCE - 1);
        vm.prank(stranger);
        vm.expectRevert(RelaisDms.NotTriggerable.selector);
        dms.trigger(subject);
        vm.prank(operator);
        vm.expectRevert(RelaisDms.NotTriggerable.selector);
        dms.trigger(subject); // l'opérateur n'a pas de passe-droit
        vm.expectRevert(RelaisDms.NotTriggerable.selector);
        dms.trigger(keccak256("unknown"));
    }

    function test_trigger_after_an_expired_pause_clears_the_pause() public {
        registerDefault();
        uint64 until = t0 + 20 * DAY;
        vm.prank(operator);
        dms.pause(subject, until, sig);
        vm.warp(until + FREQ + SILENCE);
        dms.trigger(subject);
        RelaisDms.Dms memory d = dms.get(subject);
        assertEq(uint8(d.status), uint8(RelaisDms.Status.Triggered));
        assertEq(d.pausedUntil, 0);
    }

    function test_a_triggered_subject_cannot_checkin_pause_or_resume() public {
        registerDefault();
        vm.warp(t0 + FREQ + SILENCE);
        dms.trigger(subject);
        vm.startPrank(operator);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.checkin(subject, t0 + FREQ + SILENCE + FREQ, sig);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.pause(subject, t0 + FREQ + SILENCE + DAY, sig);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.resume(subject, t0 + FREQ + SILENCE + FREQ, sig);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- cancelTrigger / complete

    function test_the_owner_cancels_a_trigger_and_a_new_cycle_starts() public {
        registerDefault();
        uint64 at = t0 + FREQ + SILENCE;
        vm.warp(at);
        dms.trigger(subject);
        vm.prank(stranger);
        vm.expectRevert(RelaisDms.NotOperator.selector);
        dms.cancelTrigger(subject, at + FREQ, sig);
        vm.prank(operator);
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.TriggerCancelled(subject, at + FREQ, sig);
        dms.cancelTrigger(subject, at + FREQ, sig);
        RelaisDms.Dms memory d = dms.get(subject);
        assertEq(uint8(d.status), uint8(RelaisDms.Status.Active));
        assertEq(d.triggeredAt, 0);
        assertEq(d.nextCheckinDue, at + FREQ);
        assertEq(dms.secondsUntilTriggerable(subject), FREQ + SILENCE);
        vm.warp(at + FREQ + SILENCE);
        dms.trigger(subject); // le cycle repart normalement
    }

    function test_cancelTrigger_requires_a_triggered_subject_and_a_later_due_date() public {
        registerDefault();
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.cancelTrigger(subject, t0 + 2 * FREQ, sig);
        vm.warp(t0 + FREQ + SILENCE);
        dms.trigger(subject);
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadDueDate.selector);
        dms.cancelTrigger(subject, t0 + FREQ, sig);
    }

    function test_the_operator_completes_a_triggered_subject() public {
        registerDefault();
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.complete(subject); // pas déclenché
        vm.warp(t0 + FREQ + SILENCE);
        dms.trigger(subject);
        vm.prank(stranger);
        vm.expectRevert(RelaisDms.NotOperator.selector);
        dms.complete(subject);
        vm.prank(operator);
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.Completed(subject);
        dms.complete(subject);
        assertEq(uint8(dms.get(subject).status), uint8(RelaisDms.Status.Completed));
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.cancelTrigger(subject, t0 + 10 * FREQ, sig); // Completed n'est pas Triggered
    }

    function test_completed_is_not_terminal_the_owner_registers_again_with_the_same_key() public {
        registerDefault();
        vm.warp(t0 + FREQ + SILENCE);
        dms.trigger(subject);
        vm.startPrank(operator);
        dms.complete(subject);
        uint64 now_ = t0 + FREQ + SILENCE;
        vm.expectRevert(RelaisDms.BadDueDate.selector);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + FREQ, sig); // ne recule pas
        dms.register(subject, pk, 3, 5, SILENCE, FREQ, now_ + FREQ, sig);
        vm.stopPrank();
        RelaisDms.Dms memory d = dms.get(subject);
        assertEq(uint8(d.status), uint8(RelaisDms.Status.Active));
        assertEq(d.n, 3);
        assertEq(d.triggeredAt, 0);
        assertEq(d.nextCheckinDue, now_ + FREQ);
    }

    // ---------------------------------------------------------------- deactivate

    function test_deactivate_from_active_paused_or_triggered_then_register_again() public {
        registerDefault();
        vm.prank(stranger);
        vm.expectRevert(RelaisDms.NotOperator.selector);
        dms.deactivate(subject, sig);
        vm.prank(operator);
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.Deactivated(subject, sig);
        dms.deactivate(subject, sig);
        RelaisDms.Dms memory d = dms.get(subject);
        assertEq(uint8(d.status), uint8(RelaisDms.Status.Inactive));
        assertEq(d.nextCheckinDue, t0 + FREQ); // conservé : la monotonie survit
        assertEq(dms.secondsUntilTriggerable(subject), type(uint256).max);

        vm.startPrank(operator);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.deactivate(subject, sig); // déjà inactif
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + 2 * FREQ, sig);
        dms.pause(subject, t0 + 10 * DAY, sig);
        dms.deactivate(subject, sig); // depuis Paused
        assertEq(dms.get(subject).pausedUntil, 0);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + 3 * FREQ, sig);
        vm.stopPrank();
        vm.warp(t0 + 3 * FREQ + SILENCE);
        dms.trigger(subject);
        vm.prank(operator);
        dms.deactivate(subject, sig); // depuis Triggered
        assertEq(dms.get(subject).triggeredAt, 0);
    }

    function test_deactivate_rejects_a_bad_signature() public {
        registerDefault();
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadSignature.selector);
        dms.deactivate(subject, new bytes(65));
    }

    // ---------------------------------------------------------------- pointeurs et hachés

    function test_setPointers_stores_the_cids_and_emits_them() public {
        registerDefault();
        bytes32[] memory packs = new bytes32[](3);
        packs[0] = keccak256("pack 1");
        packs[1] = keccak256("pack 2");
        packs[2] = keccak256("pack 3");
        bytes32 vault = keccak256("vault");
        vm.prank(operator);
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.Pointers(subject, packs, vault);
        dms.setPointers(subject, packs, vault);
        (bytes32[] memory gotPacks, bytes32 gotVault) = dms.pointers(subject);
        assertEq(gotPacks.length, 3);
        assertEq(gotPacks[1], packs[1]);
        assertEq(gotVault, vault);

        bytes32[] memory fewer = new bytes32[](1);
        fewer[0] = keccak256("pack 1 v2");
        vm.prank(operator);
        dms.setPointers(subject, fewer, bytes32(0)); // remplace, ne cumule pas
        (gotPacks, gotVault) = dms.pointers(subject);
        assertEq(gotPacks.length, 1);
        assertEq(gotPacks[0], fewer[0]);
        assertEq(gotVault, bytes32(0));
    }

    function test_setPointers_rejects_more_packs_than_contacts_or_an_inactive_subject() public {
        bytes32[] memory packs = new bytes32[](1);
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.setPointers(subject, packs, bytes32(0)); // Inactive
        registerDefault(); // m = 3
        bytes32[] memory tooMany = new bytes32[](4);
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadThreshold.selector);
        dms.setPointers(subject, tooMany, bytes32(0));
        vm.prank(stranger);
        vm.expectRevert(RelaisDms.NotOperator.selector);
        dms.setPointers(subject, packs, bytes32(0));
    }

    function test_setShareHashes_stores_one_hash_per_contact() public {
        registerDefault();
        bytes32[] memory hashes = new bytes32[](3);
        hashes[0] = keccak256("S1_enc");
        hashes[1] = keccak256("S2_enc");
        hashes[2] = keccak256("S3_enc");
        vm.prank(operator);
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.ShareHashes(subject, hashes);
        dms.setShareHashes(subject, hashes);
        bytes32[] memory got = dms.shareHashes(subject);
        assertEq(got.length, 3);
        assertEq(got[2], hashes[2]);

        bytes32[] memory wrongCount = new bytes32[](2);
        vm.prank(operator);
        vm.expectRevert(RelaisDms.BadThreshold.selector);
        dms.setShareHashes(subject, wrongCount); // exactement m
    }

    function test_pointers_survive_trigger_and_are_readable_by_anyone() public {
        registerDefault();
        bytes32[] memory packs = new bytes32[](2);
        packs[0] = keccak256("a");
        packs[1] = keccak256("b");
        vm.prank(operator);
        dms.setPointers(subject, packs, keccak256("v"));
        vm.warp(t0 + FREQ + SILENCE);
        vm.prank(stranger);
        dms.trigger(subject);
        vm.prank(stranger);
        (bytes32[] memory got,) = dms.pointers(subject);
        assertEq(got.length, 2);
    }

    function test_deactivate_and_complete_clear_pointers_and_hashes() public {
        registerDefault();
        bytes32[] memory three = new bytes32[](3);
        vm.startPrank(operator);
        dms.setPointers(subject, three, keccak256("v"));
        dms.setShareHashes(subject, three);
        dms.deactivate(subject, sig);
        vm.stopPrank();
        (bytes32[] memory packs, bytes32 vault) = dms.pointers(subject);
        assertEq(packs.length, 0);
        assertEq(vault, bytes32(0));
        assertEq(dms.shareHashes(subject).length, 0);

        vm.startPrank(operator);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + 2 * FREQ, sig);
        dms.setPointers(subject, three, keccak256("v"));
        vm.stopPrank();
        vm.warp(t0 + 2 * FREQ + SILENCE);
        dms.trigger(subject);
        vm.prank(operator);
        dms.complete(subject);
        (packs, vault) = dms.pointers(subject);
        assertEq(packs.length, 0);
    }

    function test_pointers_and_hashes_are_frozen_once_triggered() public {
        registerDefault();
        bytes32[] memory three = new bytes32[](3);
        vm.startPrank(operator);
        dms.setPointers(subject, three, keccak256("v"));
        dms.setShareHashes(subject, three);
        dms.pause(subject, t0 + 10 * DAY, sig);
        dms.setPointers(subject, three, keccak256("v2")); // en pause : encore permis
        dms.resume(subject, t0 + 2 * FREQ, sig);
        vm.stopPrank();
        vm.warp(t0 + 2 * FREQ + SILENCE);
        dms.trigger(subject);
        vm.startPrank(operator);
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.setPointers(subject, three, keccak256("v3"));
        vm.expectRevert(RelaisDms.BadStatus.selector);
        dms.setShareHashes(subject, three);
        vm.stopPrank();
        (, bytes32 vault) = dms.pointers(subject);
        assertEq(vault, keccak256("v2"));
    }

    // ---------------------------------------------------------------- opérateur

    function test_operator_rotation_takes_two_steps() public {
        address next = makeAddr("next operator");
        vm.prank(stranger);
        vm.expectRevert(RelaisDms.NotOperator.selector);
        dms.proposeOperator(next);

        vm.prank(operator);
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.OperatorProposed(next);
        dms.proposeOperator(next);
        assertEq(dms.operator(), operator);
        assertEq(dms.pendingOperator(), next);

        vm.prank(stranger);
        vm.expectRevert(RelaisDms.NotPendingOperator.selector);
        dms.acceptOperator();

        vm.prank(next);
        vm.expectEmit(true, false, false, true);
        emit RelaisDms.OperatorAccepted(next);
        dms.acceptOperator();
        assertEq(dms.operator(), next);
        assertEq(dms.pendingOperator(), address(0));

        vm.prank(operator);
        vm.expectRevert(RelaisDms.NotOperator.selector);
        dms.register(subject, pk, 2, 3, SILENCE, FREQ, t0 + FREQ, sig);
    }

    function test_constructor_rejects_the_zero_operator() public {
        vm.expectRevert(RelaisDms.ZeroAddress.selector);
        new RelaisDms(address(0));
    }

    function test_contract_refuses_ether() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(dms).call{value: 1}("");
        assertFalse(ok);
    }
}
