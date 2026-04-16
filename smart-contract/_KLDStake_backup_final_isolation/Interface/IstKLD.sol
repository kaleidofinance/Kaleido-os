// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.9;

interface IstKLD {
    // Events
    event TransferShares(address indexed from, address indexed to, uint256 sharesValue);
    event SharesBurnt(
        address indexed account,
        uint256 preRebaseTokenAmount,
        uint256 postRebaseTokenAmount,
        uint256 sharesAmount
    );

    // ERC20 Standard Functions
    function name() external pure returns (string memory);
    function symbol() external pure returns (string memory);
    function decimals() external pure returns (uint8);
    function totalSupply() external view returns (uint256);
    function balanceOf(address _account) external view returns (uint256);
    function transfer(address _recipient, uint256 _amount) external returns (bool);
    function allowance(address _owner, address _spender) external view returns (uint256);
    function approve(address _spender, uint256 _amount) external returns (bool);
    function transferFrom(address _sender, address _recipient, uint256 _amount) external returns (bool);
    function increaseAllowance(address _spender, uint256 _addedValue) external returns (bool);
    function decreaseAllowance(address _spender, uint256 _subtractedValue) external returns (bool);

    // Staking Specific Functions
    function getTotalPooledKLD() external view returns (uint256);
    function getTotalShares() external view returns (uint256);
    function sharesOf(address _account) external view returns (uint256);
    function getSharesByPooledKld(uint256 _ethAmount) external view returns (uint256);
    function getPooledKldByShares(uint256 _sharesAmount) external view returns (uint256);
    /// @notice Mints staking shares to a user
    /// @param to The address receiving the shares
    /// @param amount The amount of shares to mint
    function mintShares(address to, uint256 amount) external;
    function burnShares(address from, uint256 sharesAmount) external;
}
