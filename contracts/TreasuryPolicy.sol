// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TreasuryPolicy {
    address public owner;
    bool public paused;
    uint256 public dailyOutflowCap;
    uint256 public perAccountBorrowCap;
    uint256 public minimumCollateralRatioBps;

    mapping(address => bool) public approvedAssets;
    mapping(address => bool) public approvedStrategies;
    mapping(address => bool) public serviceOperators;
    mapping(address => bool) public verifiers;
    mapping(address => bool) public arbitrators;

    uint256 public currentDay;
    uint256 public outflowToday;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PauseUpdated(bool paused);
    event AssetApprovalUpdated(address indexed asset, bool approved);
    event StrategyApprovalUpdated(address indexed strategy, bool approved);
    event ServiceOperatorUpdated(address indexed operator, bool approved);
    event VerifierUpdated(address indexed verifier, bool approved);
    event ArbitratorUpdated(address indexed arbitrator, bool approved);
    event DailyOutflowCapUpdated(uint256 newCap);
    event PerAccountBorrowCapUpdated(uint256 newCap);
    event MinimumCollateralRatioUpdated(uint256 newRatioBps);
    event OutflowRecorded(uint256 day, uint256 amount, uint256 newTotal);

    error Unauthorized();
    error Paused();
    error OutflowCapExceeded();

    constructor() {
        owner = msg.sender;
        dailyOutflowCap = type(uint256).max;
        perAccountBorrowCap = type(uint256).max;
        minimumCollateralRatioBps = 15_000;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_ADDRESS");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setPaused(bool newPaused) external onlyOwner {
        paused = newPaused;
        emit PauseUpdated(newPaused);
    }

    function setApprovedAsset(address asset, bool approved) external onlyOwner {
        approvedAssets[asset] = approved;
        emit AssetApprovalUpdated(asset, approved);
    }

    function setApprovedStrategy(address strategy, bool approved) external onlyOwner {
        approvedStrategies[strategy] = approved;
        emit StrategyApprovalUpdated(strategy, approved);
    }

    function setServiceOperator(address operator, bool approved) external onlyOwner {
        serviceOperators[operator] = approved;
        emit ServiceOperatorUpdated(operator, approved);
    }

    function setVerifier(address verifier, bool approved) external onlyOwner {
        verifiers[verifier] = approved;
        emit VerifierUpdated(verifier, approved);
    }

    function setArbitrator(address arbitrator, bool approved) external onlyOwner {
        arbitrators[arbitrator] = approved;
        emit ArbitratorUpdated(arbitrator, approved);
    }

    function setDailyOutflowCap(uint256 cap) external onlyOwner {
        dailyOutflowCap = cap;
        emit DailyOutflowCapUpdated(cap);
    }

    function setPerAccountBorrowCap(uint256 cap) external onlyOwner {
        perAccountBorrowCap = cap;
        emit PerAccountBorrowCapUpdated(cap);
    }

    function setMinimumCollateralRatioBps(uint256 ratioBps) external onlyOwner {
        require(ratioBps >= 10_000, "LOW_RATIO");
        minimumCollateralRatioBps = ratioBps;
        emit MinimumCollateralRatioUpdated(ratioBps);
    }

    function recordOutflow(uint256 amount) external whenNotPaused {
        if (!serviceOperators[msg.sender]) revert Unauthorized();
        uint256 dayNumber = block.timestamp / 1 days;
        if (dayNumber != currentDay) {
            currentDay = dayNumber;
            outflowToday = 0;
        }
        outflowToday += amount;
        if (outflowToday > dailyOutflowCap) revert OutflowCapExceeded();
        emit OutflowRecorded(dayNumber, amount, outflowToday);
    }
}

