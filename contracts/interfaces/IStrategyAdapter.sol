// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStrategyAdapter {
    function strategyId() external view returns (bytes32);
    function asset() external view returns (address);
    function deposit(uint256 amount) external returns (uint256 sharesMinted);
    function withdraw(uint256 shares, address recipient) external returns (uint256 assetsReturned);
    function totalShares() external view returns (uint256);
    function totalAssets() external view returns (uint256);
    function maxWithdraw(address account) external view returns (uint256);
    function riskLabel() external view returns (string memory);
}
