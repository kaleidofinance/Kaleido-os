// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract KaleidoVault is Ownable(msg.sender), ReentrancyGuard {
    using SafeERC20 for IERC20;

    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed to, address indexed token, uint256 amount);
    event TokensAdded(address[] tokens);
    event Paused(address indexed admin);
    event Unpaused(address indexed admin);

    error InvalidFeeAmount();
    error InvalidTokenAddress();
    error EthTransferFailed();
    error EthAmountMismatch();
    error InvalidRecipient();
    error VaultPaused();
    error VaultNotPaused();

    mapping(address => bool) public isAcceptedToken;
    address[] private acceptedTokens;

    address public constant NATIVE_TOKEN = address(1);

    /// @dev Public so the state is readable on-chain. It was `private`, and with
    ///      `receive()` no longer guarded (see below) the flag's only remaining
    ///      effect is to make the owner's own calls revert — so the operator
    ///      needs to be able to check it before sending one, and reconstructing
    ///      it from the Paused/Unpaused event log is a poor substitute.
    bool public paused;




    modifier validToken(address token) {
        if (!isAcceptedToken[token]) revert InvalidTokenAddress();
        _;
    }

    modifier amountNotZero(uint256 amount) {
        if (amount == 0) revert InvalidFeeAmount();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert VaultPaused();
        _;
    }

    modifier whenPaused() {
        if (!paused) revert VaultNotPaused();
        _;
    }

    function addTokens(address[] calldata tokens) external onlyOwner whenNotPaused {
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0)) revert InvalidTokenAddress();
            if (!isAcceptedToken[tokens[i]]) {
                isAcceptedToken[tokens[i]] = true;
                acceptedTokens.push(tokens[i]);
            }
        }
        emit TokensAdded(tokens);
    }

    function depositFees(address token, uint256 amount)
        external
        payable
        nonReentrant
        validToken(token)
        amountNotZero(amount)
        whenNotPaused
    {
        if (token == NATIVE_TOKEN) {
            if (msg.value != amount) revert EthAmountMismatch();
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
        emit Deposit(msg.sender, token, amount);
    }

    /* `validToken` was on this function and is deliberately gone.
     *
     * Nothing that actually reaches this vault goes through `depositFees`:
     * ProtocolFacet pays native fees with a bare value-call into `receive()`
     * and ERC20 fees with a plain `transfer`, and neither touches
     * `isAcceptedToken`. So the allowlist never described the vault's holdings —
     * but it still governed their withdrawal, which made it a one-way door. Any
     * fee in a token the owner had not pre-registered was stuck here
     * permanently, and native fees always were: `NATIVE_TOKEN` is `address(1)`,
     * not a token anyone would think to pass to `addTokens`.
     *
     * It also protected nothing. This function is `onlyOwner`, and an owner
     * sweeping an unexpected token out of the fee vault is the contract's
     * purpose rather than an attack on it. The allowlist stays on `depositFees`,
     * where declaring what the vault accepts is the point, and `whenNotPaused`
     * stays here, where freezing outflows is what pause should mean.
     */
    function withdrawFees(address token, uint256 amount, address payable to)
        external
        onlyOwner
        nonReentrant
        amountNotZero(amount)
        whenNotPaused
    {
        if (token == address(0)) revert InvalidTokenAddress();
        if (to == address(0)) revert InvalidRecipient();

        if (token == NATIVE_TOKEN) {
            if (address(this).balance < amount) revert InvalidFeeAmount();
            (bool success, ) = to.call{value: amount}("");
            if (!success) revert EthTransferFailed();
        } else {
            uint256 balance = IERC20(token).balanceOf(address(this));
            if (balance < amount) revert InvalidFeeAmount();
            IERC20(token).safeTransfer(to, amount);
        }
        emit Withdraw(to, token, amount);
    }

    function getAcceptedTokens() external view returns (address[] memory) {
        return acceptedTokens;
    }

    /// @notice Pause vault operations (onlyOwner)
    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause vault operations (onlyOwner)
    function unpause() external onlyOwner whenPaused {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /* No `whenNotPaused`, deliberately.
     *
     * This is the protocol's fee sink, and ProtocolFacet pays native fees into
     * it with a bare `call{value: protocolFee}("")` whose success is `require`d
     * (_repayLoan, ~line 1047). A reverting `receive()` therefore does not
     * "refuse a deposit" — it reverts the *caller's* transaction, and the caller
     * is a borrower repaying a native loan.
     *
     * Pausing the vault used to brick native repayment outright: the borrower
     * could not repay at any price, interest kept accruing on the outstanding
     * balance, and the position drifted toward liquidation for a reason that had
     * nothing to do with the borrower or their collateral. An admin action on a
     * fee account must not be able to do that. The ERC20 branch was never
     * exposed, because a plain `transfer` to a contract runs none of its code —
     * so the pause flag silently applied to one asset class and not the other.
     *
     * Pause is meaningful on outflows and on the allowlist, where it stops the
     * owner acting. It is not meaningful on inflows, where the only thing it can
     * stop is someone paying the protocol what it is owed. Treasury contracts
     * take money unconditionally for this reason; OpenZeppelin's Escrow and
     * PaymentSplitter both expose an unguarded payable entry point.
     */
    receive() external payable {
        emit Deposit(msg.sender, NATIVE_TOKEN, msg.value);
    }
}
