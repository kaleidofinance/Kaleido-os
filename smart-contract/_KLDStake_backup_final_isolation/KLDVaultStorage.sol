// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
import "./Interface/IKLDVault.sol";
import "./Interface/IstKLD.sol";


contract KLDVaultStorage  {

    address public admin;
    // IKLDToken public immutable IkldToken;
    IstKLD public IstKLDToken;

    struct UserInfo {
       uint256 totalKldDeposit;
         bool hasStaked;
         bool hasRequestedWithdrawal;
    }

    // uint256 public totalPooledKLD;
    uint256 public totalStakers;
    uint256 public  WITHDRAWAL_WAITING_PERIOD = 14 days;

    mapping(address => UserInfo) public userinfo;
    mapping(address => bool) public supportedToken;
    mapping(address => uint256) public totalPooledKLD;
    mapping(address => uint256) public totalShares;
    mapping(address => uint256) public withdrawalRequestTimestamp;


    address public kldToken;




}