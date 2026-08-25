// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title Provides functions for deriving a pool address from the factory, tokens, and the fee
library PoolAddress {
    /// @dev keccak256 of KaleidoSwapV3Pool's creation bytecode, as built by the
    /// settings on the 0.7.6 entry in hardhat.config.js (solc 0.7.6, optimizer
    /// runs=200, metadata.bytecodeHash="none").
    ///
    /// This is NOT upstream Uniswap's value. It held
    /// 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54 until
    /// 2026-08-20, which was the hash of *their* pool — this fork is renamed, so
    /// KaleidoSwapV3PoolDeployer emits different creation code and every derived
    /// address was wrong.
    ///
    /// The periphery resolves pools by CREATE2 derivation from this constant
    /// rather than by asking the factory, and the swap callback authenticates
    /// msg.sender against the derived address. A wrong value therefore does not
    /// fail at deploy — the factory still creates pools — it fails at the first
    /// swap, against an address that holds no code.
    ///
    /// It is a property of the compiled bytecode, so it moves with the compiler
    /// version and the optimizer settings. After any change to the 0.7.6 entry,
    /// re-run scripts/verify-pool-init-hash.js and update this constant and the
    /// poolInitCodeHash in src/constants/registry.ts together.
    bytes32 internal constant POOL_INIT_CODE_HASH = 0xcc2ce4a3b82b174879c877ec55dd52475d3e31a30b7ba006307e278f22942938;

    /// @notice The identifying key of the pool
    struct PoolKey {
        address token0;
        address token1;
        uint24 fee;
    }

    /// @notice Returns PoolKey: the ordered tokens with the matched fee levels
    /// @param tokenA The first token of a pool, unsorted
    /// @param tokenB The second token of a pool, unsorted
    /// @param fee The fee level of the pool
    /// @return Poolkey The pool details with ordered token0 and token1 assignments
    function getPoolKey(
        address tokenA,
        address tokenB,
        uint24 fee
    ) internal pure returns (PoolKey memory) {
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);
        return PoolKey({token0: tokenA, token1: tokenB, fee: fee});
    }

    /// @notice Deterministically computes the pool address given the factory and PoolKey
    /// @param factory The KaleidoSwap V3 factory contract address
    /// @param key The PoolKey
    /// @return pool The contract address of the V3 pool
    function computeAddress(address factory, PoolKey memory key) internal pure returns (address pool) {
        require(key.token0 < key.token1);
        pool = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex'ff',
                            factory,
                            keccak256(abi.encode(key.token0, key.token1, key.fee)),
                            POOL_INIT_CODE_HASH
                        )
                    )
                )
            )
        );
    }
}
