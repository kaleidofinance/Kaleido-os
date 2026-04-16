// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import './pool/IKaleidoSwapV3PoolImmutables.sol';
import './pool/IKaleidoSwapV3PoolState.sol';
import './pool/IKaleidoSwapV3PoolDerivedState.sol';
import './pool/IKaleidoSwapV3PoolActions.sol';
import './pool/IKaleidoSwapV3PoolOwnerActions.sol';
import './pool/IKaleidoSwapV3PoolEvents.sol';

/// @title The interface for a KaleidoSwap V3 Pool
/// @notice A KaleidoSwap pool facilitates swapping and automated market making between any two assets that strictly conform
/// to the ERC20 specification
/// @dev The pool interface is broken up into many smaller pieces
interface IKaleidoSwapV3Pool is
    IKaleidoSwapV3PoolImmutables,
    IKaleidoSwapV3PoolState,
    IKaleidoSwapV3PoolDerivedState,
    IKaleidoSwapV3PoolActions,
    IKaleidoSwapV3PoolOwnerActions,
    IKaleidoSwapV3PoolEvents
{

}
