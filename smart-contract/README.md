# Kaleido Smart Contracts

Comprehensive smart contract suite for the Kaleido DeFi Protocol, built with the EIP-2535 Diamond Standard for modularity and upgradability.

![Kaleido Logo](../public/orange-logo-vertical.png)

## Overview

Kaleido smart contracts implement a complete DeFi ecosystem including:
- **Lending & Borrowing**: Peer-to-peer lending with flexible terms
- **Liquid Staking**: Stake KLD tokens and earn stKLD rewards
- **Stablecoin (kfUSD)**: Multi-collateral stablecoin with yield vault
- **AMM DEX**: Token swaps and liquidity pools

## Architecture

### Diamond Standard (EIP-2535)

The protocol uses a Diamond Standard architecture for modularity and upgradability:

```
Diamond (Proxy)
├── DiamondCutFacet (upgrade functionality)
├── DiamondLoupeFacet (introspection)
├── OwnershipFacet (access control)
├── ProtocolFacet (lending/borrowing)
└── Future facets (staking, DEX, etc.)
```

**Benefits**:
- ✅ Add new functionality without contract migration
- ✅ Fix bugs and upgrade features seamlessly
- ✅ No data migration required
- ✅ Reduced gas costs through function selector optimization

## Core Contracts

### Lending & Borrowing

- **ProtocolFacet.sol**: Main lending/borrowing logic
  - Create loan offers
  - Accept/fulfill loan requests
  - Manage collateral
  - Liquidations

- **Vault.sol**: Collateral management vault
  - Multi-token collateral support
  - Collateral health monitoring
  - Automated liquidation triggers

### Liquid Staking

- **KLDVault.sol**: KLD staking vault
  - Receive KLD deposits
  - Issue stKLD tokens
  - Track deposits and withdrawals

- **stKLD.sol**: Liquid staking token
  - ERC-20 compliant
  - Represents staked KLD
  - Transferable and composable

### Stablecoin

- **kfUSD.sol**: Multi-collateral stablecoin
  - Mint with USDC, USDT, USDe
  - Redeem to any supported collateral
  - Dynamic fees (0.1% - 0.3%)
  - Minimum 10% idle collateral
  - Decimal precision protection

- **kafUSD.sol**: Yield vault token
  - Lock kfUSD to earn yield
  - 7-day cooldown for withdrawals
  - Real yield distribution

### Supporting Contracts

- **Diamond.sol**: Main Diamond contract
- **DiamondCutFacet.sol**: Facet management
- **DiamondLoupeFacet.sol**: Contract introspection
- **OwnershipFacet.sol**: Access control
- **PythPriceOracle.sol**: Price oracle integration
- **Validator.sol**: Input validation utilities

## Features

### Security

- ✅ **Reentrancy Protection**: OpenZeppelin ReentrancyGuard
- ✅ **Access Control**: Role-based permissions
- ✅ **Decimal Precision**: Proper handling of different token decimals
- ✅ **Fee Limits**: Maximum 3% cap on fees
- ✅ **Collateral Management**: Minimum idle collateral for redemptions
- ✅ **Pausable**: Emergency stop mechanism

### Audited Contracts

All contracts have been thoroughly audited for:
- Reentrancy attacks
- Flash loan attacks
- Price oracle manipulation
- Integer overflow/underflow
- Access control issues
- Decimal precision errors
- Front-running vulnerabilities
- Dust attacks

See [SECURITY_AUDIT_COMPLETE.md](./SECURITY_AUDIT_COMPLETE.md) for details.

## Getting Started

### Prerequisites

- Node.js 18+
- Hardhat 2.22+
- Solidity 0.8.9 - 0.8.24

### Installation

```bash
# Install dependencies
npm install
# or
yarn install
```

### Compilation

```bash
# Compile all contracts
npx hardhat compile

# Compile with specific Solidity version
npx hardhat compile --config hardhat.config.js
```

### Running Tests

```bash
# Run all tests
npx hardhat test

# Run specific test file
npx hardhat test test/StablecoinSecurity.test.js

# Run with gas reporting
REPORT_GAS=true npx hardhat test
```

### Deployment

```bash
# Deploy to local network
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost

# Deploy to Abstract Testnet
npx hardhat run scripts/deploy.js --network abstractTestnet

# Deploy to Abstract Mainnet
npx hardhat run scripts/deploy.js --network abstractMainnet
```

## Network Configuration

### Abstract Testnet

- **Chain ID**: 11124
- **RPC URL**: `https://api.testnet.abs.xyz`
- **Explorer**: https://sepolia.abscan.org/
- **Type**: zkSync Era-compatible

### Abstract Mainnet

- **Chain ID**: 2741
- **RPC URL**: `https://api.mainnet.abs.xyz`
- **Explorer**: https://abscan.org/
- **Type**: zkSync Era-compatible

## Contract Addresses

### Abstract Testnet

#### Diamond Infrastructure (EIP-2535)
- **Diamond**: `0x7286F2708f8f4d0a1a1b6c19f5D14AdB4c3207B2`
- **DiamondCutFacet**: `0x26E8D28be621253Ea834210a9B955C244e84D64a`
- **DiamondLoupeFacet**: `0x50e53dbbe0ffb102676c4c44faCf7D6BbD6362BD`
- **OwnershipFacet**: `0xe614d6De7E342ae9394b4EA813285E1371dd779e`
- **DiamondInit**: `0x0BCd2893e7a5919DfDff95173dB1d0C5DceF85C0`

#### Protocol Facets
- **ProtocolFacet**: `0x09C4De2818D8DAaBefA1aDb016134199f1418aaB`

#### Stablecoin Ecosystem
- **kfUSD** (Stablecoin): `0x7f815685a7D686Ced7AE695c01974425C4ee7790`
  - Multi-collateral stablecoin
  - Supports minting with USDC, USDT, USDe
  - Dynamic fees: 0.1% - 0.3%
  - Explorer: https://sepolia.abscan.org/address/0x7f815685a7D686Ced7AE695c01974425C4ee7790

- **kafUSD** (Yield Vault Token): `0x8e78C32eFE55e77335f488dd0bf87A8Eb9d39D6c`
  - Liquid staking token for kfUSD
  - Lock kfUSD to earn yield
  - 7-day withdrawal cooldown
  - Explorer: https://sepolia.abscan.org/address/0x8e78C32eFE55e77335f488dd0bf87A8Eb9d39D6c

#### Supported Collateral Tokens
- **USDC** (Official): `0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3`
- **USDT** (Deployed): `0x1313141d819A1F4d704824f48982DFE007C0bB39`
- **USDe** (Deployed): `0x04dea9d324212d1F4c4a87F3F0ff80cf3b014e10`

#### Liquid Staking
- **KLDVault**: Check explorer for latest deployment
- **stKLD** (Liquid Staking Token): Check explorer for latest deployment

### Explorer Links

- **Abstract Testnet Explorer**: https://sepolia.abscan.org/
- **All Contracts**: https://sepolia.abscan.org/address/0x7286F2708f8f4d0a1a1b6c19f5D14AdB4c3207B2#readProxyContract

## Development Scripts

### Setup

```bash
# Setup deployment ratio for stablecoin
npx hardhat run scripts/set-deployment-ratio.js --network abstractTestnet

# Check contract state
npx hardhat run scripts/check-contract-state.js --network abstractTestnet
```

### Verification

```bash
# Verify contract on explorer
npx hardhat verify --network abstractTestnet DEPLOYED_CONTRACT_ADDRESS "Constructor Arg 1" "Constructor Arg 2"
```

## Security Best Practices

1. **Always use nonReentrant modifier** on external functions that transfer funds
2. **Check access control** before allowing state-changing operations
3. **Validate inputs** with proper require statements
4. **Handle decimals correctly** when working with different token types
5. **Use SafeERC20** for token transfers
6. **Implement Circuit Breakers** for emergency situations
7. **Follow Checks-Effects-Interactions** pattern

## Testing

### Test Coverage

- Unit tests for all major functions
- Integration tests for cross-contract interactions
- Security tests for known vulnerabilities
- Edge case testing

### Running Security Tests

```bash
# Run security test suite
npx hardhat test test/StablecoinSecurity.test.js

# Test specific vulnerability
npx hardhat test test/StablecoinSecurity.test.js --grep "Decimal Precision"
```

## Documentation

- [Security Audit Complete](../docs/security/SECURITY_AUDIT_COMPLETE.md) - Full security analysis
- [Security Findings](../docs/security/SECURITY_FINDINGS.md) - Detailed findings and fixes
- [Testnet Deployment Guide](../docs/guides/TESTNET_DEPLOYMENT_GUIDE.md) - Deployment instructions
- [Stablecoin Integration](../docs/guides/STABLECOIN_INTEGRATION.md) - kfUSD/kafUSD integration
- [Run Tests](../docs/guides/RUN_TESTS.md) - Testing setup guide
- [Full Documentation](../docs/) - Complete documentation index

## Contributing

When contributing to smart contracts:

1. Write comprehensive tests for new features
2. Follow the existing code style
3. Add NatSpec comments for all public functions
4. Update documentation
5. Run the security test suite
6. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For questions or issues:
- Discord: [Kaleido Discord](https://discord.com/invite/kaleido)
- Twitter: [@kaleido_finance](https://x.com/kaleido_finance)
- Documentation: [GitBook](https://kaleidos-finance.gitbook.io/kaleido/)

---

**Kaleido Smart Contracts** - Secure, Modular, Upgradable DeFi Infrastructure