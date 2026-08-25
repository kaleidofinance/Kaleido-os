import { providerForChain } from "@/config/provider";
import { findTokenBySymbol, getContracts } from "@/constants/registry";

/**
 * Read provider for a chain, or null if the registry has no RPC for it.
 *
 * Was a six-case switch that restated URLs already in chains.ts (Base, Arbitrum,
 * Polygon, Mainnet, Hyperliquid — all of them duplicated), mapped `case 11124` to
 * the app's read provider, and ended in `default: return readOnlyProvider`. That
 * default is the defect: an unlisted chain did not fail, it silently answered
 * from the read chain, so an allowance read for Base Sepolia came back as
 * whatever the read chain said. It only looked harmless while the read chain WAS
 * 11124, which made the explicit case and the default agree with each other.
 *
 * Callers must handle null. See providerForChain in config/provider.ts.
 */
export const getProviderByChainId = providerForChain;

/**
 * Which USDC to use on a chain, or undefined if there is none there.
 *
 * The deploy record wins over the canonical token list, because the two answer
 * different questions. `getContracts(chainId).usdc` is the USDC the protocol was
 * actually wired against on that chain — the address kfUSD mints against and the
 * one `deploy-stablecoin.js` was given. `findTokenBySymbol` is the canonical
 * third-party USDC, which is the right answer on Sepolia and Base Sepolia and does
 * not exist at all on BSC Testnet, Robinhood Testnet or Arc Testnet, where we mint
 * a mock. Preferring the record means the allowance we read is the allowance the
 * protocol will check.
 *
 * Was a switch over `SUPPORTED_CHAIN_ID` returning an Abstract literal from
 * either branch — and its second case indexed `[1]` of a one-element array, so it
 * matched only an undefined chainId. Returns undefined rather than a default now:
 * an allowance read against the wrong token silently reports zero, which reads as
 * "needs approval" and sends an approval for a token the user does not hold.
 */
export const getUsdcAddressByChainId = (
  chainId: number | undefined,
): string | undefined =>
  getContracts(chainId).usdc ?? findTokenBySymbol(chainId, "USDC")?.address;

/*
 * Deleted: getUsdcBalance, getUsdRBalance, getKfUSDBalance, getUSDTBalance.
 *
 * All four had zero callers — the file is imported only for the two functions
 * above — and each read a hardcoded Abstract token address through whatever
 * provider the switch returned, so none could have produced a correct figure on
 * any chain in this wave. `fetchOmniAssetBalance`
 * (constants/utils/omniChainBalances.ts) is the live version of the same job and
 * is chain-keyed.
 *
 * getUsdRBalance carried the note that USDR is 6 decimals rather than 18; that
 * finding is recorded where it still applies, on BORROW_CURRENCIES in
 * constants/registry.ts.
 */
