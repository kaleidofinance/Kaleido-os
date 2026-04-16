// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
import "./KLDVaultStorage.sol";
import "./KLDVaultErrorReporter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import "./Interface/IstKLD.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";



/**
 * @title KLD Vault
 * @author Kaleido
 * @notice The KLD Vault is configured for users to stake KLD and receive stKLD representing their position and earn yield over time.
 */
 
contract KLDVault is KLDVaultStorage, Pausable, ReentrancyGuard, Ownable(msg.sender) {
    using SafeERC20 for IERC20;
    

    modifier tokenAllowed(address _token) {
        if(!supportedToken[_token]) {
            revert  KLDVault_TokenNotSupported();
        }
        _;
    }
    modifier moreThanZero(uint256 _depositAmount) {
        if(_depositAmount == 0) {
            revert KLDVault_InvalidDepositAmount();
        }
               _;
    }

    event TokenDeposited(address indexed token,  address indexed user, uint256 amount, uint256 totalSharesMinted, uint256 time);
    event TokenWithdrawn(address indexed token,  address indexed user, uint256 amount, uint256 time);
    event RewardsCompounded(address indexed token, uint256 rewardAmount, uint256 newTotalPooled);
    event WithdrawalRequested(address indexed from, uint256 time);
    event TokenSupported(address indexed token);
    event WithdrawalRequestCancelled(address indexed user);



    /**
    * @notice Allows a user to deposit underlying KLD tokens into the vault and receive proportional stKLD shares.
    *         Shares minted represent the user's stake in the pooled KLD and accrue rewards over time.
    *
    * @dev
    * - Requires the vault to be not paused.
    * - Requires both `_token` and `_stKLDToken` to be allowed tokens.
    * - Requires `_depositAmount` to be greater than zero.
    * - Prevents depositing stKLD tokens directly to avoid recursion or logic errors.
    * - Transfers `_depositAmount` of KLD tokens from the user to the vault.
    * - Calculates the number of shares to mint based on the current share price.
    * - If the vault is empty (no shares or pooled KLD), mints shares equal to the deposit amount.
    * - Updates the total pooled KLD amount.
    * - Updates user staking status and total stakers count.
    * - Mints calculated shares to the user.
    *
    * @param _token The address of the underlying KLD token to deposit.
    * @param _stKLDToken The address of the stKLD token representing shares in the vault.
    * @param _depositAmount The amount of KLD tokens the user wants to deposit.
    */
    function deposit(address _token, address _stKLDToken, uint256 _depositAmount) whenNotPaused  tokenAllowed(_token) tokenAllowed(_stKLDToken)  moreThanZero(_depositAmount) nonReentrant  external  {
        if(_depositAmount == 0) revert KLDVault_InvalidDepositAmount();
        IERC20(_token).transferFrom(msg.sender, address(this), _depositAmount);

       if (_token == _stKLDToken) revert KLDVault_SameTokenNotAllowed();

      //calculate the sharesToMint for user calculating the shares propotional to their deposit
        uint256 sharesToMint;
         if(getTotalShares(_stKLDToken) == 0 || getTotalPooledKld(_token) == 0) {
            sharesToMint = _depositAmount;
         } else {
          sharesToMint =  ( _depositAmount * getTotalShares(_stKLDToken)) / getTotalPooledKld(_token);
         }
         totalPooledKLD[_token] += _depositAmount;  
        if (!userinfo[msg.sender].hasStaked) {
            totalStakers++;
            userinfo[msg.sender].hasStaked = true;
        }

        IstKLD(_stKLDToken).mintShares(msg.sender, sharesToMint);
        emit TokenDeposited(_token, msg.sender, _depositAmount, sharesToMint, block.timestamp);

    }

    

    /**
    * @notice Allows a user to withdraw a specified amount of underlying KLD tokens from the vault.
    *         The withdrawal burns the proportional amount of stKLD shares from the user.
    *         A cooldown period must have passed since the withdrawal request.
    *
    * @dev
    * - Requires the vault to be not paused.
    * - Requires both `_kldtoken` and `_stKLDToken` to be allowed tokens.
    * - Requires `_kldAmount` to be greater than zero.
    * - Requires the user to have requested withdrawal and the cooldown period to have elapsed.
    * - Calculates the number of shares to burn based on the current share price.
    * - Ensures the user has sufficient shares to burn.
    * - Ensures the vault contract has enough KLD tokens to fulfill the withdrawal.
    * - Updates the total pooled KLD amount.
    * - Burns the calculated shares from the user.
    * - Transfers the underlying KLD tokens back to the user.
    * - Resets the user's withdrawal request timestamp.
    *
    * @param _kldtoken The address of the underlying KLD token to withdraw.
    * @param _stKLDToken The address of the stKLD token representing shares in the vault.
    * @param _kldAmount The amount of underlying KLD tokens the user wants to withdraw.
    */
    function withdraw(address _kldtoken, address _stKLDToken, uint256 _kldAmount) whenNotPaused  tokenAllowed(_kldtoken) tokenAllowed(_stKLDToken)  moreThanZero(_kldAmount) nonReentrant  external {
        // if (userinfo[msg.sender].totalKldDeposit < _kldAmount) revert KLDVault_InvalidWithdrawAmount();
        if(_kldAmount == 0) revert KLDVault_InvalidWithdrawAmount();
        // Ensure cooldown period has passed
        uint256 requestTime = withdrawalRequestTimestamp[msg.sender];   
        if(requestTime == 0) revert KLDVault_WithdrawalNotRequested();
        if (block.timestamp < requestTime + WITHDRAWAL_WAITING_PERIOD) revert KLD_VaultWithdrawalWaitingPeriodNotPassed();

        // Calculate shares to burn BEFORE updating totalPooledKLD
        uint256 sharesToBurn = (_kldAmount * getTotalShares(_stKLDToken)) / totalPooledKLD[_kldtoken];
        require(sharesToBurn > 0, "Invalid share amount");
        require(IstKLD(_stKLDToken).sharesOf(msg.sender) >= sharesToBurn, "Insufficient shares");
        uint256 kldToReturn = (sharesToBurn * totalPooledKLD[_kldtoken]) / getTotalShares(_stKLDToken);


        uint256 contractBalance = IERC20(_kldtoken).balanceOf(address(this));
        if (contractBalance < kldToReturn) revert KLDVault_ContractInsufficientBalance();

        // Update user and global state
        totalPooledKLD[_kldtoken] -= kldToReturn;

        // Burn shares from user
        IstKLD(_stKLDToken).burnShares(msg.sender, sharesToBurn);
   
        // Transfer underlying tokens back to user
        IERC20(_kldtoken).safeTransfer(msg.sender, kldToReturn);
        withdrawalRequestTimestamp[msg.sender] = 0;

        emit TokenWithdrawn(_kldtoken, msg.sender, kldToReturn, block.timestamp);
    
    }


    /**
    * @notice Allows a user to request a withdrawal of their stKLD tokens.
    *         Starts the cooldown period before the user can actually withdraw.
    *
    * @dev
    * - The contract must not be paused.
    * - Users cannot request withdrawal if they have already requested and not yet withdrawn or cancelled.
    * - User must have a positive stKLD token balance to request withdrawal.
    * - Records the current block timestamp as the withdrawal request time.
    *
    * @param _stKLDToken The address of the stKLD token contract.
    */
    function requestWithdrawal(address _stKLDToken) whenNotPaused  external {
        if(withdrawalRequestTimestamp[msg.sender] != 0) revert KLDVault_AlreadyRequestedWithdrawal();
         uint256 userBalance = IERC20(_stKLDToken).balanceOf(msg.sender);
        if(userBalance == 0) revert KLDVault_InvalidWithdrawAmount();
        withdrawalRequestTimestamp[msg.sender] = block.timestamp;
        emit WithdrawalRequested(msg.sender, block.timestamp);
    }


    /**
    * @notice Allows a user to cancel a previously requested withdrawal.
    *
    * @dev
    * - User must have an active withdrawal request.
    * - Resets the withdrawal request timestamp to zero.
    */
    function cancelWithdrawalRequest() external whenNotPaused{
        uint256 lastWithdrawalRequested =  withdrawalRequestTimestamp[msg.sender];
        if(lastWithdrawalRequested == 0) revert KLDVault_WithdrawalNotRequested();
         withdrawalRequestTimestamp[msg.sender] = 0;
        emit WithdrawalRequestCancelled(msg.sender);
    }


    /**
    * @notice Returns the total number of shares issued for the given stKLD token.
    * @param _stKLDToken The address of the stKLD token contract.
    * @return totalShare The total shares currently issued.
    */
    function getTotalShares(address _stKLDToken) public view returns(uint256) {
        uint256 totalShare = IstKLD(_stKLDToken).getTotalShares();
        return totalShare;
    }

    
    /**
    * @notice Returns the total pooled KLD tokens in the vault for a given token.
    * @param _token The address of the underlying KLD token.
    * @return totalPoolKld The total amount of KLD pooled in the vault.
    */
    function getTotalPooledKld(address _token) public view returns(uint256) {
        uint256 totalPoolKld = totalPooledKLD[_token];
        return totalPoolKld;
    }

    /**
    * @notice Returns the equivalent KLD deposit amount for a user based on their shares.
    * @param _user The address of the user.
    * @param _stKLDToken The address of the stKLD token contract.
    * @return userKLDDeposit The user's deposit amount in KLD tokens.
    */
    function getUserDeposit(address _user, address _stKLDToken) public view returns(uint256) {
        uint256 userShares = IstKLD(_stKLDToken).sharesOf(_user);  
        uint256 userKLDDeposit = IstKLD(_stKLDToken).getPooledKldByShares(userShares);
        return userKLDDeposit;
    }

    /**
    * @notice Returns the total number of unique stakers in the vault.
    * @return totalStakers The count of total stakers.
    */
    function getTotalStakers() public view returns(uint256) {
        return totalStakers;
    }

    /**
    * @notice Adds a token to the list of supported tokens for deposits and withdrawals.
    * @dev Only callable by the contract owner.
    * @param _token The address of the token to support.
    */
    function setSupportedToken(address _token) external onlyOwner {
        supportedToken[_token] = true;
        emit TokenSupported(_token);
    }


    /**
    * @notice Returns the remaining cooldown time before a user can withdraw after requesting withdrawal.
    * @param _user The address of the user.
    * @return timeLeft The time in seconds left before withdrawal is allowed. Returns 0 if no cooldown or cooldown passed.
    */
    function getWithdrawalTimeLeft(address _user) external view returns (uint256) {
        uint256 requestTime = withdrawalRequestTimestamp[_user];
        if (requestTime == 0) {
            return 0; 
        }
        uint256 endTime = requestTime + WITHDRAWAL_WAITING_PERIOD;
        if (block.timestamp >= endTime) {
            return 0;
        }
        return endTime - block.timestamp; 
    }


    /**
    * @notice Pauses the contract, disabling deposits and withdrawals.
    * @dev Only callable by the contract owner.
    */
    function pause() external onlyOwner {
        _pause();
    }

    /**
    * @notice Unpauses the contract, enabling deposits and withdrawals.
    * @dev Only callable by the contract owner.
    */
    function unpause() external onlyOwner {
        _unpause();
    }




    /**
    * @notice Allows the contract owner to compound staking rewards into the vault, increasing the total pooled KLD.
    *         This function transfers the reward tokens from the owner to the vault and updates the total pooled amount.
    *
    * @dev
    * - Only callable by the contract owner.
    * - Requires `rewardAmount` to be greater than zero.
    * - Transfers `rewardAmount` of `_token` from the owner to the vault contract.
    * - Increases the `totalPooledKLD` balance by the reward amount.
    * - Emits a `RewardsCompounded` event to notify about the reward addition.
    *
    * @param _token The address of the KLD token in which rewards are compounded.
    * @param rewardAmount The amount of reward tokens to compound into the vault.
    */
    function compoundRewards(address _token, uint256 rewardAmount) moreThanZero(rewardAmount)  external onlyOwner {
        IERC20(_token).safeTransferFrom(msg.sender, address(this), rewardAmount);
        totalPooledKLD[_token] += rewardAmount;
        emit RewardsCompounded(_token, rewardAmount, totalPooledKLD[_token]);
    }


}

