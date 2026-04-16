# Kaleido Agentic DeFI OS: The Unified Intelligent OS for DeFI

![Kaleido Logo](public/orange-logo-vertical.png)

## Overview

Kaleido Agentic DeFI OS is an **all-in-one modular DeFi protocol** built with the **EIP-2535 Diamond Standard** for scalability & upgradability. Our mission is to provide a unified liquidity layer where users can access every major DeFi primitive — from lending and trading to staking and fundraising — in a single, composable UX.

The frontend is built with **Next.js** and **TypeScript** to provide a seamless user experience, integrating **Luca AI** (our primary on‑platform agent), **smart wallet** functionality, and **stablecoin** products.

### Key Innovations

- **Modular Architecture** → Flexible, upgradeable protocol design using Diamond Standard for long-term scalability
- **AI-Native Experience** → Intelligent lending suggestions, risk scoring, and automation powered by AI
- **Integrated Engagement Layer** → Real-time points system, referral engine, and social login to onboard users seamlessly
- **Multi-Chain Architecture** → Deployable on Abstract, Arbitrum, Polygon, Base, and other EVM chains with unified UX
- **Stablecoin Ecosystem** → kfUSD stablecoin with yield vault (kafUSD) for sustainable returns

### Core Products

- **Lending & Borrowing** → P2P lending marketplace with flexible terms and AI-powered risk assessment
- **AMM DEX + Farm** → Token swaps, liquidity pools, and yield farming opportunities
- **Liquid Staking ($stKLD)** → Stake KLD tokens and earn rewards with liquid staking derivatives
- **Stablecoin (kfUSD)** → Multi-collateral stablecoin with yield generating vault (kafUSD)
- **Luca AI (Primary Agent)** → Personalized guidance, risk insights, and automation across Kaleido
- **AI Agent Services (x402, optional)** → Payments layer for external/third‑party agents
- **IDO Launchpad** → Fundraising platform for new projects and investment opportunities

### Technical Features

- **Next.js 14** with App Router for optimal performance and SEO
- **TypeScript** for type safety and developer experience
- **Smart Wallet Integration** for gas-efficient transactions
- **Luca AI (Primary)** for personalized navigation, risk insights, and automation
- **x402 Protocol (Optional)** for agent-to-agent payments by external agents
- **Tailwind CSS** for responsive, modern UI design
- **Diamond Standard (EIP-2535)** for modular, upgradeable smart contracts
- **Multi-Chain Deployment** across Abstract, Arbitrum, Polygon, Base, and other EVM chains

## Stablecoin Products

### kfUSD - Multi-Collateral Stablecoin
A decentralized stablecoin backed by multiple assets (USDC, USDT, USDe) with:
- **1:1 Conversion**: Mint/redeem at 1:1 ratio with supported collaterals
- **Dynamic Fees**: 0.1% - 0.3% based on transaction size
- **Yield Vault**: Lock kfUSD to earn yield in kafUSD
- **Security**: Comprehensive security audit with decimal precision protection
- **Minimum Redemption**: 0.001 kfUSD to prevent dust attacks

### kafUSD - Yield Vault Token
Liquid staking token for kfUSD holders:
- **Earn Yield**: Lock kfUSD to automatically earn rewards
- **Cooldown Period**: 7-day withdrawal cooldown for security
- **Flexible Withdrawal**: Request and complete withdrawal after cooldown
- **Real Yield**: Powered by deployed collateral in yield protocols

## AI System

### Luca AI (Primary)
Luca is Kaleido’s built-in AI agent that personalizes the user experience, provides risk insights, guides lending/borrowing decisions, and automates common workflows across the app.

### x402 Services (Optional)

### Agent-to-Agent Payments
Kaleido additionally supports the x402 HTTP payments protocol for third‑party or external agents to pay for services programmatically using blockchain payments.

### Available Services
- **Trade Execution** (0.1 USDC): Execute optimal token swaps
- **Lending Optimization** (0.05 USDC): Optimize lending strategies
- **Portfolio Rebalancing** (0.15 USDC): Rebalance portfolios automatically
- **Risk Analysis** (0.02 USDC): Comprehensive risk assessment
- **Liquidity Management** (0.08 USDC): Optimize liquidity positions
- **Stablecoin Operations** (0.03 USDC): Mint/redeem kfUSD efficiently
- **Lending Analytics** (0.01 USDC): Detailed lending insights
- **Yield Optimization** (0.12 USDC): Find best yield opportunities

### How It Works
```typescript
// Agent makes payment-enabled request
POST /api/ai/execute-trade
Headers: {
  'X-PAYMENT': <base64_encoded_payment>
}

// Server verifies payment & executes
→ Payment verified on-chain
→ Trade executed optimally
→ Response with transaction receipt
```

See [X402_INTEGRATION_PLAN.md](./X402_INTEGRATION_PLAN.md) for implementation details.

## Security

All smart contracts have undergone comprehensive security audits:

- ✅ **Decimal Precision**: Proper handling of 18-decimal kfUSD and 6-decimal USDC
- ✅ **Fee Limits**: Maximum 3% cap on mint/redeem fees
- ✅ **Collateral Management**: Minimum 10% idle collateral for redemptions
- ✅ **Reentrancy Protection**: OpenZeppelin ReentrancyGuard on all critical functions
- ✅ **Access Control**: Role-based permissions with PAUSER_ROLE for emergencies
- ✅ **Minimum Amounts**: Protection against dust attacks and rounding errors

See [`smart-contract/SECURITY_AUDIT_COMPLETE.md`](./smart-contract/SECURITY_AUDIT_COMPLETE.md) for detailed security information.

## Project Structure

```
kaleido-main/
├── src/                    # Frontend source code
│   ├── app/               # Next.js app directory (pages & layouts)
│   ├── components/        # React components
│   ├── hooks/             # Custom React hooks
│   ├── context/           # React context providers
│   ├── config/            # Configuration files
│   └── utils/             # Utility functions
├── smart-contract/         # Smart contracts
│   ├── contracts/         # Solidity contracts
│   │   ├── Diamond.sol   # Main Diamond contract
│   │   ├── facets/       # Diamond facets (lending, staking, etc.)
│   │   └── Stablecoin/   # kfUSD and kafUSD contracts
│   ├── test/             # Contract tests
│   └── scripts/          # Deployment scripts
├── public/                # Static assets
├── server/               # Backend services (liquidation bots, oracles)
└── docs/                 # Documentation
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn
- Git
- MetaMask or compatible Web3 wallet

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/kaleido/frontend.git
   cd kaleido-main
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. Run the development server:
   ```bash
   npm run dev
   # or
   yarn dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

### Connect to Networks

Kaleido Agentic DeFI OS is designed for multi-chain deployment. Currently, the platform is deployed on:

#### Abstract Testnet (Primary)
- **Network**: Abstract Testnet (Chain ID: 11124)
- **RPC URL**: `https://api.testnet.abs.xyz`
- **Explorer**: https://sepolia.abscan.org/

#### Supported Networks (Coming Soon)
- **Arbitrum**: High-throughput layer 2 for reduced gas costs
- **Polygon**: Wide user base and low transaction fees
- **Base**: Coinbase's layer 2 for mainstream adoption
- **Ethereum**: Mainnet for ultimate security and liquidity

**Add Abstract Testnet to MetaMask:**
1. Go to MetaMask → Networks → Add Network
2. Enter the Abstract Testnet details above
3. Get test tokens from the faucet if needed

**Chain Switching:**
Users can switch between supported networks directly from the UI. All features work consistently across all chains.

## Smart Contracts

### Diamond Architecture

The protocol uses the Diamond Standard (EIP-2535) for modularity:
- **Diamond**: Main contract that holds all state
- **Facets**: Separate contracts with specific functionality
- **Upgrades**: Add/remove/replace facets without migration

### Core Contracts

- **Diamond.sol**: Main proxy contract
- **ProtocolFacet.sol**: Lending and borrowing logic
- **KLDVault.sol**: Liquid staking vault for KLD
- **stKLD.sol**: Liquid staking token
- **kfUSD.sol**: Multi-collateral stablecoin
- **kafUSD.sol**: Yield vault token for kfUSD

### Deployment

Deploy to any supported network:

```bash
cd smart-contract
yarn install
yarn hardhat compile

# Deploy to Abstract Testnet (primary)
yarn hardhat run scripts/deploy.js --network abstractTestnet

# Deploy to other networks
yarn hardhat run scripts/deploy.js --network arbitrum
yarn hardhat run scripts/deploy.js --network polygon
yarn hardhat run scripts/deploy.js --network base
```

The Diamond Standard architecture ensures contract compatibility across all EVM chains.

## Development

### Running Tests

```bash
# Frontend tests
npm run test

# Smart contract tests
cd smart-contract
yarn hardhat test
```

### Code Quality

```bash
# Linting
npm run lint

# Type checking
npm run type-check
```

### Building for Production

   ```bash
   npm run build
npm start
```

## Documentation

Full documentation is available in the [docs](./docs/) directory:

- [Documentation Index](./docs/README.md) - Complete documentation overview
- [Security & Audits](./docs/security/) - Security reports and audits
- [User Guides](./docs/guides/) - Integration guides and tutorials

Key documentation:
- [Security Audit Complete](./docs/security/SECURITY_AUDIT_COMPLETE.md) - Comprehensive security analysis
- [Stablecoin Integration](./docs/guides/STABLECOIN_INTEGRATION.md) - kfUSD/kafUSD documentation
- [Featured Pools](./docs/guides/FEATURED_POOL_INTEGRATION.md) - Lending pool integration guide
- [Redemption Guide](./docs/guides/REDEMPTION_GUIDE.md) - Guide to redeeming kfUSD

## Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style (Prettier + ESLint)
- Write tests for new features
- Update documentation as needed
- Follow conventional commit messages

## Deployed Contracts

> **Note**: Kaleido Agentic DeFI OS uses a multi-chain architecture. Contracts are designed to be deployed on Abstract, Arbitrum, Polygon, Base, and other EVM chains.

### Abstract Testnet (Current Deployment)

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
- **kafUSD** (Yield Vault): `0x8e78C32eFE55e77335f488dd0bf87A8Eb9d39D6c`

#### Supported Collateral Tokens
- **USDC**: `0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3` (Official USDC)
- **USDT**: `0x1313141d819A1F4d704824f48982DFE007C0bB39`
- **USDe**: `0x04dea9d324212d1F4c4a87F3F0ff80cf3b014e10`

#### Token Addresses
- **KLD Token**: Check Abstract explorer for latest deployment
- **stKLD Token**: Check Abstract explorer for latest deployment

## Roadmap

- [x] Core Lending & Borrowing Platform
- [x] Liquid Staking (stKLD)
- [x] AMM DEX and Farming
- [x] Stablecoin (kfUSD/kafUSD)
- [x] Security Audit
- [x] Multi-Chain Infrastructure
- [ ] IDO Launchpad
- [ ] Cross-Chain Bridges
- [ ] Multi-Chain Deployments (Arbitrum, Polygon, Base)
- [ ] Mobile App
- [ ] Professional Trading Interface

## Support & Community

- **Discord**: [Join our Discord](https://discord.com/invite/kaleido)
- **Twitter**: [@kaleido_finance](https://x.com/kaleido_finance)
- **Telegram**: [Telegram Channel](https://t.me/kaleidofinance)
- **Documentation**: [GitBook](https://kaleidos-finance.gitbook.io/kaleido/)
- **Website**: [kaleidofinance.xyz](https://kaleidofinance.xyz)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- OpenZeppelin for secure contract libraries
- Abstract Network for infrastructure support
- Multiple blockchain communities for network support
- The DeFi community for inspiration and feedback

## Multi-Chain Strategy

Kaleido Finance is designed for **multi-chain deployment** to reach users across the entire Ethereum ecosystem:

- **Chain-Agnostic Core**: Diamond Standard contracts work on any EVM network
- **Network-Specific Optimizations**: Tailored features for each chain's capabilities  
- **Unified User Experience**: Same UI works seamlessly across all chains
- **Cross-Chain Ready**: Infrastructure prepared for cross-chain bridges
- **Liquidity Aggregation**: Aggregate liquidity from all deployed chains

Users can choose their preferred network without compromise, accessing the same powerful DeFi tools with optimized gas costs and transaction speeds.

---

**Kaleido Agentic DeFI OS** redefines the DeFi experience by merging **powerful infrastructure** with **user-first design**, creating a platform where liquidity is efficient, yield is sustainable, and access is frictionless across all major blockchains.

Built with ❤️ by the Kaleido team for multi-chain DeFi