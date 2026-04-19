// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TreasuryPolicy} from "./TreasuryPolicy.sol";
import {IStrategyAdapter} from "./interfaces/IStrategyAdapter.sol";

contract StrategyAdapterRegistry {
    TreasuryPolicy public immutable policy;

    struct StrategyMetadata {
        bytes32 strategyId;
        address adapter;
        address asset;
        string riskLabel;
        bool active;
    }

    mapping(bytes32 => StrategyMetadata) public strategies;
    bytes32[] internal strategyIds;
    mapping(bytes32 => bool) internal strategyKnown;

    event StrategyRegistered(bytes32 indexed strategyId, address indexed adapter, address indexed asset, string riskLabel);
    event StrategyStatusUpdated(bytes32 indexed strategyId, bool active);

    error Unauthorized();
    error StrategyNotApproved();

    constructor(TreasuryPolicy policy_) {
        policy = policy_;
    }

    modifier onlyOwner() {
        if (msg.sender != policy.owner()) revert Unauthorized();
        _;
    }

    function registerStrategy(address adapter) external onlyOwner {
        if (!policy.approvedStrategies(adapter)) revert StrategyNotApproved();
        bytes32 id = IStrategyAdapter(adapter).strategyId();
        if (!strategyKnown[id]) {
            strategyKnown[id] = true;
            strategyIds.push(id);
        }
        strategies[id] = StrategyMetadata({
            strategyId: id,
            adapter: adapter,
            asset: IStrategyAdapter(adapter).asset(),
            riskLabel: IStrategyAdapter(adapter).riskLabel(),
            active: true
        });
        emit StrategyRegistered(id, adapter, IStrategyAdapter(adapter).asset(), IStrategyAdapter(adapter).riskLabel());
    }

    function setStrategyActive(bytes32 strategyId, bool active) external onlyOwner {
        strategies[strategyId].active = active;
        emit StrategyStatusUpdated(strategyId, active);
    }

    function getStrategy(bytes32 strategyId) external view returns (StrategyMetadata memory) {
        return strategies[strategyId];
    }

    function listStrategyIds() external view returns (bytes32[] memory) {
        return strategyIds;
    }
}
