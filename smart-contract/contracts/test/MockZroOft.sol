// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ILayerZeroOFT } from "../../contracts/bridge/ZeroAutoBridge.sol";

/// @notice Test mock of LayerZero V2 $ZRO OFT with toggleable route open/closed state.
contract MockZroOft is ERC20, ILayerZeroOFT {
    bool public routeOpen = false;
    uint256 public fixedNativeFee = 0.001 ether;
    uint64 public nonceCounter;

    bytes32 public lastTo;
    uint32 public lastDstEid;
    uint256 public lastAmountLD;

    error RouteClosed();
    error InsufficientFee();

    constructor() ERC20("LayerZero", "ZRO") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setRouteOpen(bool open) external {
        routeOpen = open;
    }

    function setNativeFee(uint256 fee) external {
        fixedNativeFee = fee;
    }

    function quoteSend(
        SendParam calldata,
        bool
    ) external view override returns (MessagingFee memory msgFee) {
        if (!routeOpen) revert RouteClosed();
        return MessagingFee({ nativeFee: fixedNativeFee, lzTokenFee: 0 });
    }

    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address
    ) external payable override returns (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt) {
        if (!routeOpen) revert RouteClosed();
        if (msg.value < fixedNativeFee || _fee.nativeFee < fixedNativeFee) revert InsufficientFee();

        _burn(msg.sender, _sendParam.amountLD);
        nonceCounter++;
        lastDstEid = _sendParam.dstEid;
        lastTo = _sendParam.to;
        lastAmountLD = _sendParam.amountLD;

        bytes32 guid = keccak256(abi.encodePacked(nonceCounter, _sendParam.to, _sendParam.amountLD));
        msgReceipt = MessagingReceipt({
            guid: guid,
            nonce: nonceCounter,
            fee: MessagingFee({ nativeFee: fixedNativeFee, lzTokenFee: 0 })
        });
        oftReceipt = OFTReceipt({
            amountSentLD: _sendParam.amountLD,
            amountReceivedLD: _sendParam.amountLD
        });
    }
}
