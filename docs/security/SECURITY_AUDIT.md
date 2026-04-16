# Stablecoin Security Audit Checklist

## Common Stablecoin Attack Vectors

### 1. Reentrancy Attacks
**Risk**: High
**Targets**: All external contract calls, especially withdrawals and redemptions
**Check**:
- [ ] Use ReentrancyGuard from OpenZeppelin
- [ ] Follow checks-effects-interactions pattern
- [ ] No external calls before state updates
- [ ] No recursive calls possible in mint/redeem functions

**Test Cases**:
- Attempt to re-enter during redemption
- Attempt to re-enter during vault withdrawal
- Check if state is updated before external transfers

### 2. Flash Loan Attacks
**Risk**: High
**Targets**: Price oracles, minting, redemption logic
**Check**:
- [ ] Oracle price updates are time-weighted or have staleness checks
- [ ] Mint/redeem operations check for flash loans
- [ ] Minimum time delays between operations
- [ ] Reserve ratio calculations resistant to temporary manipulation

**Test Cases**:
- Flash loan large amount → manipulate price → mint kfUSD → redeem
- Flash loan → manipulate backing ratio
- Multi-block flash loan attacks

### 3. Price Oracle Manipulation
**Risk**: High
**Targets**: Minting, redemption, backing ratio
**Check**:
- [ ] Multiple price sources (chainlink, pyth, twap)
- [ ] Price staleness checks
- [ ] Maximum price deviation limits
- [ ] Circuit breakers for extreme price movements

**Test Cases**:
- Manipulate single oracle source
- Stale price data usage
- Rapid price changes
- Oracle failures/outages

### 4. Integer Overflow/Underflow
**Risk**: Medium (Solidity 0.8+ has built-in checks, but verify)
**Targets**: Amount calculations, supply tracking
**Check**:
- [ ] Solidity 0.8+ compiler (automatic checks)
- [ ] SafeMath usage if older version
- [ ] Maximum supply limits
- [ ] Decimal precision handling (6 vs 18 decimals)

**Test Cases**:
- Maximum uint256 amounts
- Extremely large mint operations
- Calculations with different decimal precisions

### 5. Decimal Precision Errors
**Risk**: Medium-High
**Targets**: USDC/USDT (6 decimals) vs kfUSD (18 decimals)
**Check**:
- [ ] Proper scaling in mint/redeem functions
- [ ] 1:1 ratio maintained correctly
- [ ] No rounding errors in favor of attacker
- [ ] Output amount validation

**Test Cases**:
- Mint with maximum precision amounts
- Small amount minting (< 0.001)
- Large amount minting
- Verify 1:1 collateral ratio

### 6. Access Control Issues
**Risk**: Critical
**Targets**: Admin functions, pause mechanisms
**Check**:
- [ ] Role-based access control (RBAC)
- [ ] Proper ownership checks
- [ ] No unauthorized minting
- [ ] Multi-sig requirements for critical functions

**Test Cases**:
- Unauthorized mint calls
- Unauthorized contract upgrades
- Missing access control on critical functions

### 7. Collateral Insufficiency
**Risk**: High
**Targets**: Redemption, backing ratio
**Check**:
- [ ] Sufficient collateral before allowing minting
- [ ] Reserve ratio validation
- [ ] Minimum collateral requirements
- [ ] Cannot redeem more than available collateral

**Test Cases**:
- Redeem when collateral insufficient
- Mint beyond collateral capacity
- Edge cases with zero collateral
- Under-collateralized redemptions

### 8. Front-Running / MEV Attacks
**Risk**: Medium
**Targets**: Transaction ordering, pricing
**Check**:
- [ ] Slippage protection (minimum output amounts)
- [ ] Maximum price impact limits
- [ ] Deadlines for transactions
- [ ] Priority fee considerations

**Test Cases**:
- Sandwich attacks on mints/redemptions
- Maximum slippage tolerance
- Price manipulation between blocks

### 9. Rounding Errors / Dust Attacks
**Risk**: Low-Medium
**Targets**: Small amount calculations
**Check**:
- [ ] Rounding direction (toward zero or up?)
- [ ] Minimum transaction amounts
- [ ] Dust accumulation handling
- [ ] Fee calculations don't drain small amounts

**Test Cases**:
- Very small mint amounts (dust)
- Accumulated rounding errors
- Minimum redemption amounts

### 10. Cooldown Bypass
**Risk**: Medium (kafUSD vault)
**Targets**: Withdrawal cooldown mechanism
**Check**:
- [ ] Cannot withdraw before cooldown completes
- [ ] Cooldown timestamps cannot be manipulated
- [ ] Multiple withdrawal requests don't bypass cooldown
- [ ] Time manipulation resistance

**Test Cases**:
- Attempt to withdraw before cooldown
- Manipulate block.timestamp (if possible)
- Multiple simultaneous withdrawal requests
- Partial withdrawal bypass attempts

### 11. Infinite Minting / Supply Inflation
**Risk**: Critical
**Targets**: Minting function, supply caps
**Check**:
- [ ] Maximum supply limit (if applicable)
- [ ] Collateral validation before minting
- [ ] Cannot mint without collateral
- [ ] Supply tracking is accurate

**Test Cases**:
- Mint without providing collateral
- Mint with zero collateral
- Exceed maximum supply (if exists)
- Double-counting in supply calculations

### 12. Fee Manipulation
**Risk**: Medium
**Targets**: Dynamic fee calculations
**Check**:
- [ ] Fee cannot be set to excessive amounts
- [ ] Fee calculations are gas-efficient
- [ ] Fee recipient cannot drain funds
- [ ] Fees don't cause rounding to zero

**Test Cases**:
- Extreme fee amounts
- Fee recipient access control
- Fee bypass attempts
- Accumulated fee handling

### 13. Vault Lock/Unlock Logic
**Risk**: High (kafUSD)
**Targets**: Asset locking, yield distribution
**Check**:
- [ ] Locked assets cannot be withdrawn immediately
- [ ] Proper accounting of locked amounts
- [ ] Yield calculations are accurate
- [ ] Cannot lock zero amounts
- [ ] Cannot unlock more than locked

**Test Cases**:
- Lock zero amount
- Unlock without initiating unlock process
- Unlock more than locked
- Yield manipulation
- Reentrancy in lock/unlock

### 14. Pause Mechanism
**Risk**: Medium
**Targets**: Emergency pause, resuming
**Check**:
- [ ] Only authorized addresses can pause
- [ ] Paused state properly prevents operations
- [ ] Cannot bypass pause in any function
- [ ] Resuming requires proper authorization

**Test Cases**:
- Bypass pause mechanism
- Unauthorized pause/resume
- Operations during paused state

### 15. Upgrade Vulnerabilities (if upgradeable)
**Risk**: High
**Targets**: Proxy patterns, initialization
**Check**:
- [ ] Initialization cannot be called twice
- [ ] Storage layout compatibility
- [ ] Proxy implementation matches
- [ ] Upgrade authorization

**Test Cases**:
- Initialize twice
- Storage collision after upgrade
- Unauthorized upgrades

### 16. ERC20 Integration Issues
**Risk**: Medium
**Targets**: Token transfers, approvals
**Check**:
- [ ] Non-standard ERC20 tokens handled (USDT)
- [ ] Transfer return value handling
- [ ] Approval patterns safe
- [ ] Balance checks before transfers

**Test Tests**:
- Tokens with no return value (USDT)
- Reverting transfers
- Insufficient balance handling

### 17. Backing Ratio Manipulation
**Risk**: High
**Targets**: Collateral backing calculations
**Check**:
- [ ] Ratio calculations are accurate
- [ ] Cannot artificially inflate/deflate ratio
- [ ] Oracle prices used correctly
- [ ] Ratio displayed accurately to users

**Test Cases**:
- Manipulate backing ratio
- Inaccurate ratio calculations
- Stale price in ratio calculations

### 18. Gas Optimization & DoS
**Risk**: Medium
**Targets**: Loops, unbounded iterations
**Check**:
- [ ] No unbounded loops
- [ ] Gas-efficient calculations
- [ ] Cannot cause DoS through gas limits
- [ ] Batch operations optimized

**Test Cases**:
- Maximum gas consumption
- Unbounded array iterations
- Gas griefing attacks

## Recommended Security Measures

1. **Use OpenZeppelin Contracts**:
   - ReentrancyGuard
   - Ownable / AccessControl
   - SafeERC20 for token operations
   - Pausable for emergency stops

2. **Implement Circuit Breakers**:
   - Maximum mint/redeem amounts per transaction
   - Rate limiting
   - Price deviation limits

3. **Multi-Oracle Price Feeds**:
   - Use Chainlink + Pyth + TWAP
   - Require consensus or median
   - Staleness checks

4. **Formal Verification**:
   - Critical functions should be formally verified
   - Mathematical proofs for backing ratio

5. **Time Delays**:
   - Minimum time between large operations
   - Cooldown periods for withdrawals

6. **Maximum Limits**:
   - Cap on total supply
   - Cap on single transaction amounts
   - Minimum transaction amounts

7. **Audit Trail**:
   - Event emissions for all state changes
   - Off-chain monitoring

## Testing Priority

1. **Critical** (Immediate):
   - Reentrancy attacks
   - Access control
   - Collateral insufficiency
   - Infinite minting

2. **High** (Before mainnet):
   - Flash loan attacks
   - Oracle manipulation
   - Decimal precision
   - Vault logic

3. **Medium** (Security audit):
   - Front-running
   - Fee manipulation
   - Cooldown bypass
   - Gas optimization

4. **Low** (Ongoing):
   - Dust attacks
   - Edge cases
   - UI/UX security


