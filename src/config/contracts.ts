import { ethers } from "ethers";
import kaleidoAbi from "@/abi/ProtocolFacet.json";
import erc20Abi from "@/abi/ERC20Abi.json";
import { envVars } from "@/constants/envVars";
import { getContracts } from "@/constants/registry";
import tokenFaucetAbi from "@/abi/TokenFaucet.json";
import KLDVaultAbi from "@/abi/KLDVaultAbi.json";
import stKLDAbi from "@/abi/StKLDAbi.json";

// Helper function to validate address and throw a clear error if missing
const validateAddress = (
  address: string | undefined,
  contractName: string,
): string => {
  if (!address || address.trim() === "") {
    throw new Error(
      `Missing contract address for ${contractName}. Please set the required environment variable (e.g., NEXT_PUBLIC_MASTER_CHEF_ADDRESS) in your .env file.`,
    );
  }
  if (!ethers.isAddress(address)) {
    throw new Error(
      `Invalid contract address for ${contractName}: "${address}". Please check your environment variables.`,
    );
  }
  return address;
};

/**
 * The Diamond on one chain.
 *
 * `chainId` is required, and it must be the chain of the provider or signer
 * passed alongside it. That pairing is the whole point: a contract instance is
 * an address bound to a connection, and the two coming from different chains is
 * not a type error — it is a call that reads or writes the wrong contract and
 * reports the result as though it were this chain's. So callers holding a wallet
 * signer pass the wallet's chain id, and callers holding `readOnlyProvider` or
 * the WebSocket provider pass `READ_ONLY_CHAIN_ID`, which is exactly what
 * config/provider.ts exports that constant for.
 *
 * The address used to come from `NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS` — a single
 * env var, so the write path was single-chain by construction and pointed at
 * whichever chain the operator last deployed to regardless of where the user's
 * wallet was. It now comes from `DEPLOYMENTS`, which is generated from the deploy
 * records, so a chain either has a Diamond recorded or it does not.
 *
 * Throws rather than returning null, deliberately, and the message names the
 * chain. Every caller is on a write path or a position read where an absent
 * address means "we cannot do this here" — the gate for that is
 * `isDeployed(chainId)`, checked before this is reached. Reaching here without an
 * address is a missing gate, and a thrown error naming the chain is what makes
 * that visible instead of a transaction sent to the zero address.
 */
export const getKaleidoContract = (
  providerOrSigner: ethers.Provider | ethers.Signer,
  chainId: number | undefined,
) => {
  const address = getContracts(chainId).diamond;
  if (!address || !ethers.isAddress(address)) {
    throw new Error(
      `No Kaleido Diamond recorded for chain ${chainId ?? "(none connected)"}. ` +
        `Deployed addresses come from DEPLOYMENTS in src/constants/registry.ts, ` +
        `which scripts/gen-registry.mjs writes from the deploy records — check ` +
        `isDeployed(chainId) before building a contract for this chain.`,
    );
  }
  return new ethers.Contract(address, kaleidoAbi, providerOrSigner);
};

/**
 * The testnet faucet on one chain.
 *
 * Same chain-paired contract as getKaleidoContract above, and for the same
 * reason. The address used to come from `NEXT_PUBLIC_TOKENFAUCET_ADDRESS`, one
 * env var for every chain — which for a faucet is worse than for most: the
 * failure is a `claim` sent to a codeless address, or to a *different chain's*
 * faucet if the operator last deployed elsewhere, and a claim that reverts looks
 * identical to a cooldown that has not elapsed.
 *
 * `faucet` is optional in ChainContracts and documented "Testnet only", so an
 * absent address is the normal state on most chains rather than an error. Callers
 * gate on `getContracts(chainId).faucet` being present — useFaucet does — and
 * this throws if they did not, rather than building a contract at undefined.
 */
export const getTokenFaucetContract = (
  providerOrSigner: ethers.Provider | ethers.Signer,
  chainId: number | undefined,
) => {
  const address = getContracts(chainId).faucet;
  if (!address || !ethers.isAddress(address)) {
    throw new Error(
      `No token faucet recorded for chain ${chainId ?? "(none connected)"}. ` +
        `Faucet addresses come from DEPLOYMENTS in src/constants/registry.ts, ` +
        `written by scripts/gen-registry.mjs from smart-contract/deployment-faucet-*.json ` +
        `— check getContracts(chainId).faucet before building a contract for this chain.`,
    );
  }
  return new ethers.Contract(address, tokenFaucetAbi, providerOrSigner);
};

/**
 * The KLD staking vault on one chain.
 *
 * Same chain-paired contract as the two above, and it is the third address to
 * move off a single env var for the same reason. This one read
 * `NEXT_PUBLIC_KLD_VAULT_ADDRESS`, which was never set — so every call here
 * threw `Missing contract address for KLD Vault`, and /stake could not be
 * exercised on any chain. There was nothing better to point it at: KLD had no
 * ERC20 in the repository, so there was no vault deployment to record.
 *
 * `scripts/deploy-kld.js` has now deployed KLD, KLDVaultV2 and StKLD on all five
 * testnets and `kldVault` comes from DEPLOYMENTS. Callers gate on
 * `stakingContracts(chainId).supported`, which is true only when all three
 * addresses are present — a vault without its token is useless, since `deposit`
 * takes the token address as an argument.
 */
export const getKLDVaultContract = (
  providerOrSigner: ethers.Provider | ethers.Signer,
  chainId: number | undefined,
) => {
  const address = getContracts(chainId).kldVault;
  if (!address || !ethers.isAddress(address)) {
    throw new Error(
      `No KLD vault recorded for chain ${chainId ?? "(none connected)"}. ` +
        `Vault addresses come from DEPLOYMENTS in src/constants/registry.ts, ` +
        `written by scripts/gen-registry.mjs from smart-contract/deployment-kld-*.json ` +
        `— check stakingContracts(chainId).supported before building a contract ` +
        `for this chain.`,
    );
  }
  return new ethers.Contract(address, KLDVaultAbi, providerOrSigner);
};

/**
 * The staked-KLD token itself.
 *
 * Needed because the vault does not expose per-user or share-total views — a
 * holder's stake is stKLD.balanceOf and the share supply is
 * stKLD.getTotalShares(). Callers pass the address, as with getERC20Contract.
 */
export const getStKLDContract = (
  providerOrSigner: ethers.Provider | ethers.Signer,
  tokenAddress: string,
) => new ethers.Contract(tokenAddress, stKLDAbi, providerOrSigner);

import KaleidoMasterChefAbi from "@/abi/KaleidoMasterChef.json";
export const getKaleidoMasterChefContract = (
  providerOrSigner: ethers.Provider | ethers.Signer,
) => {
  const address = validateAddress(
    envVars.masterChefAddress,
    "Kaleido MasterChef",
  );
  return new ethers.Contract(address, KaleidoMasterChefAbi, providerOrSigner);
};

// export const getMulticallContract = (providerOrSigner: ethers.Provider | ethers.Signer) =>
// new ethers.Contract(
//     envVars.multicallContract || "",
//     multicallAbi,
//     providerOrSigner
// );

export const getERC20Contract = (
  providerOrSigner: ethers.Provider | ethers.Signer,
  tokenAddress: string,
) => new ethers.Contract(tokenAddress, erc20Abi, providerOrSigner);
