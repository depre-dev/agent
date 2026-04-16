// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import {MockERC20} from "../contracts/mocks/MockERC20.sol";
import {TreasuryPolicy} from "../contracts/TreasuryPolicy.sol";
import {StrategyAdapterRegistry} from "../contracts/StrategyAdapterRegistry.sol";
import {AgentAccountCore} from "../contracts/AgentAccountCore.sol";

/// @notice Pins the agent-to-agent transfer primitive. Moving liquid
///         balance between two on-platform accounts is pure bookkeeping —
///         no ERC20 transfer — so these tests verify the accounting +
///         access-control gates, not any external asset flow.
contract SendToAgentTest is Test {
    TreasuryPolicy internal policy;
    StrategyAdapterRegistry internal registry;
    AgentAccountCore internal accounts;
    MockERC20 internal dot;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal operator = address(0xBEEF);

    uint256 internal constant ALICE_DEPOSIT = 1_000 ether;

    function setUp() public {
        policy = new TreasuryPolicy();
        registry = new StrategyAdapterRegistry(policy);
        accounts = new AgentAccountCore(policy, registry);
        dot = new MockERC20("Mock DOT", "mDOT");

        policy.setApprovedAsset(address(dot), true);
        policy.setServiceOperator(operator, true);

        dot.mint(alice, ALICE_DEPOSIT);
        vm.startPrank(alice);
        dot.approve(address(accounts), type(uint256).max);
        accounts.deposit(address(dot), ALICE_DEPOSIT);
        vm.stopPrank();
    }

    function _liquid(address account) internal view returns (uint256) {
        (uint256 liquid, , , , , ) = accounts.positions(account, address(dot));
        return liquid;
    }

    function testSendToAgentMovesLiquidBalance() public {
        vm.prank(alice);
        accounts.sendToAgent(bob, address(dot), 10 ether);
        assertEq(_liquid(alice), ALICE_DEPOSIT - 10 ether);
        assertEq(_liquid(bob), 10 ether);
    }

    function testSendToAgentRejectsZeroAmount() public {
        vm.prank(alice);
        (bool ok,) = address(accounts).call(
            abi.encodeCall(accounts.sendToAgent, (bob, address(dot), 0))
        );
        require(!ok, "EXPECTED_ZERO_AMOUNT_REVERT");
    }

    function testSendToAgentRejectsSelfTransfer() public {
        vm.prank(alice);
        (bool ok,) = address(accounts).call(
            abi.encodeCall(accounts.sendToAgent, (alice, address(dot), 1 ether))
        );
        require(!ok, "EXPECTED_INVALID_RECIPIENT_REVERT");
    }

    function testSendToAgentRejectsZeroAddress() public {
        vm.prank(alice);
        (bool ok,) = address(accounts).call(
            abi.encodeCall(accounts.sendToAgent, (address(0), address(dot), 1 ether))
        );
        require(!ok, "EXPECTED_INVALID_RECIPIENT_REVERT");
    }

    function testSendToAgentRejectsInsufficientLiquidity() public {
        vm.prank(alice);
        (bool ok,) = address(accounts).call(
            abi.encodeCall(accounts.sendToAgent, (bob, address(dot), ALICE_DEPOSIT + 1 ether))
        );
        require(!ok, "EXPECTED_INSUFFICIENT_LIQUIDITY_REVERT");
    }

    function testSendToAgentRejectsUnsupportedAsset() public {
        MockERC20 other = new MockERC20("Other", "OTH");
        vm.prank(alice);
        (bool ok,) = address(accounts).call(
            abi.encodeCall(accounts.sendToAgent, (bob, address(other), 1 ether))
        );
        require(!ok, "EXPECTED_UNSUPPORTED_ASSET_REVERT");
    }

    function testSendToAgentPausesWithProtocol() public {
        policy.setPaused(true);
        vm.prank(alice);
        (bool ok,) = address(accounts).call(
            abi.encodeCall(accounts.sendToAgent, (bob, address(dot), 1 ether))
        );
        require(!ok, "EXPECTED_PAUSED_REVERT");
    }

    function testSendToAgentForAllowsOperatorRelay() public {
        vm.prank(operator);
        accounts.sendToAgentFor(alice, bob, address(dot), 25 ether);
        assertEq(_liquid(alice), ALICE_DEPOSIT - 25 ether);
        assertEq(_liquid(bob), 25 ether);
    }

    function testSendToAgentForRejectsNonOperator() public {
        vm.prank(bob);
        (bool ok,) = address(accounts).call(
            abi.encodeCall(accounts.sendToAgentFor, (alice, bob, address(dot), 1 ether))
        );
        require(!ok, "EXPECTED_UNAUTHORIZED_REVERT");
    }

    function testSendToAgentForStillRejectsSelfTransfer() public {
        vm.prank(operator);
        (bool ok,) = address(accounts).call(
            abi.encodeCall(accounts.sendToAgentFor, (alice, alice, address(dot), 1 ether))
        );
        require(!ok, "EXPECTED_INVALID_RECIPIENT_REVERT");
    }
}
