// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IKLDVault {
    function getTotalPooledKld(address _token) external view returns (uint256);
}

/**
 * @title StKLD - Liquid Staked KLD
 * @notice Interest-bearing ERC20 token representing KLD staked in the Sovereign Vault.
 * @dev Modernized for 1.5.15 Yul-optimized DNA and AYPS Yield Treasury integration.
 */
contract StKLD is IERC20, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    
    address public immutable kldVault;
    address public immutable kldToken;
    
    uint256 private totalShares;
    mapping(address => uint256) private shares;
    mapping(address => mapping(address => uint256)) private allowances;

    event TransferShares(address indexed from, address indexed to, uint256 sharesValue);

    constructor(address _kldVault, address _kldToken) {
        require(_kldVault != address(0) && _kldToken != address(0), "Invalid addresses");
        kldVault = _kldVault;
        kldToken = _kldToken;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VAULT_ROLE, _kldVault);
    }

    // --- ERC20 Standard ---

    function name() external pure returns (string memory) { return "Liquid Staked KLD"; }
    function symbol() external pure returns (string memory) { return "stKLD"; }
    function decimals() external pure returns (uint8) { return 18; }

    function totalSupply() public view override returns (uint256) {
        return _getTotalPooledKLD();
    }

    function balanceOf(address account) public view override returns (uint256) {
        return getPooledKldByShares(shares[account]);
    }

    function transfer(address recipient, uint256 amount) external override whenNotPaused returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external override whenNotPaused returns (bool) {
        uint256 currentAllowance = allowances[sender][msg.sender];
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");
        
        if (currentAllowance != type(uint256).max) {
            allowances[sender][msg.sender] = currentAllowance - amount;
        }
        
        _transfer(sender, recipient, amount);
        return true;
    }

    // --- Shares Logic ---

    function getTotalShares() external view returns (uint256) {
        return totalShares;
    }

    function sharesOf(address account) external view returns (uint256) {
        return shares[account];
    }

    function getPooledKldByShares(uint256 shareAmount) public view returns (uint256) {
        uint256 _totalShares = totalShares;
        if (_totalShares == 0) return 0;
        return (shareAmount * _getTotalPooledKLD()) / _totalShares;
    }

    function getSharesByPooledKld(uint256 kldAmount) public view returns (uint256) {
        uint256 _totalPooled = _getTotalPooledKLD();
        if (_totalPooled == 0) return kldAmount;
        return (kldAmount * totalShares) / _totalPooled;
    }

    // --- Vault Controlled ---

    function mintShares(address to, uint256 shareAmount) external onlyRole(VAULT_ROLE) returns (uint256) {
        totalShares += shareAmount;
        shares[to] += shareAmount;
        
        emit TransferShares(address(0), to, shareAmount);
        emit Transfer(address(0), to, getPooledKldByShares(shareAmount));
        return totalShares;
    }

    function burnShares(address from, uint256 shareAmount) external onlyRole(VAULT_ROLE) returns (uint256) {
        require(shares[from] >= shareAmount, "Burn amount exceeds balance");
        
        uint256 tokenAmount = getPooledKldByShares(shareAmount);
        totalShares -= shareAmount;
        shares[from] -= shareAmount;
        
        emit TransferShares(from, address(0), shareAmount);
        emit Transfer(from, address(0), tokenAmount);
        return totalShares;
    }

    // --- Internal ---

    function _getTotalPooledKLD() internal view returns (uint256) {
        return IKLDVault(kldVault).getTotalPooledKld(kldToken);
    }

    function _transfer(address sender, address recipient, uint256 amount) internal {
        uint256 shareAmount = getSharesByPooledKld(amount);
        require(shares[sender] >= shareAmount, "Transfer amount exceeds balance");
        
        shares[sender] -= shareAmount;
        shares[recipient] += shareAmount;
        
        emit Transfer(sender, recipient, amount);
        emit TransferShares(sender, recipient, shareAmount);
    }
}
