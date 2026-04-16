/**
 * x402 Payment Signing Utilities
 * Allows agents to create and sign payment payloads
 */

import { ethers } from 'ethers';
import type { PaymentPayload, ExactPaymentPayload, PaymentRequirements } from './types';
import { randomBytes } from 'crypto';

/**
 * Generate a payment payload and sign it
 */
export async function createAndSignPayment(
  requirements: PaymentRequirements,
  signer: ethers.Wallet | ethers.JsonRpcSigner
): Promise<string> {
  // Generate nonce
  const nonce = ethers.hexlify(randomBytes(32));

  // Get current timestamp
  const timestamp = Math.floor(Date.now() / 1000);

  // Create exact payment payload
  const paymentPayload: ExactPaymentPayload = {
    amount: requirements.maxAmountRequired,
    asset: requirements.asset,
    payTo: requirements.payTo,
    timestamp,
    nonce,
    signature: {
      r: '0x',
      s: '0x',
      v: 0
    }
  };

  // Get provider for chain ID
  const provider = signer.provider;
  if (!provider) {
    throw new Error('Signer must have a provider');
  }

  // Build EIP-712 typed data
  const network = await provider.getNetwork();
  const domain = {
    name: 'Kaleido AI Services',
    version: '1',
    chainId: Number(network.chainId),
    verifyingContract: requirements.asset
  };

  const types = {
    Payment: [
      { name: 'amount', type: 'uint256' },
      { name: 'asset', type: 'address' },
      { name: 'payTo', type: 'address' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ]
  };

  const value = {
    amount: paymentPayload.amount,
    asset: paymentPayload.asset,
    payTo: paymentPayload.payTo,
    timestamp: paymentPayload.timestamp,
    nonce: paymentPayload.nonce
  };

  // Sign with EIP-712
  const signature = await signer.signTypedData(domain, types, value);
  const sig = ethers.Signature.from(signature);

  // Add signature to payload
  paymentPayload.signature = {
    r: sig.r,
    s: sig.s,
    v: sig.v
  };

  // Create full payment payload
  const fullPayment: PaymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: requirements.network,
    payload: paymentPayload
  };

  // Encode as base64 for X-PAYMENT header
  const encoded = Buffer.from(JSON.stringify(fullPayment)).toString('base64');

  return encoded;
}

/**
 * Helper: Create payment header for HTTP requests
 */
export async function createPaymentHeader(
  requirements: PaymentRequirements,
  signer: ethers.Wallet | ethers.JsonRpcSigner
): Promise<Record<string, string>> {
  const paymentData = await createAndSignPayment(requirements, signer);
  return {
    'X-PAYMENT': paymentData
  };
}

/**
 * Helper: Get available balance for an agent
 */
export async function checkAgentBalance(
  address: string,
  tokenAddress: string,
  rpcUrl: string
): Promise<string> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  // If it's a native token, return ETH balance
  if (tokenAddress === ethers.ZeroAddress) {
    const balance = await provider.getBalance(address);
    return balance.toString();
  }

  // Otherwise, get ERC20 balance
  const erc20Abi = [
    'function balanceOf(address owner) view returns (uint256)'
  ];
  const token = new ethers.Contract(tokenAddress, erc20Abi, provider);
  const balance = await token.balanceOf(address);
  
  return balance.toString();
}

/**
 * Helper: Estimate gas for a transaction
 */
export async function estimateTransactionCost(
  to: string,
  data: string,
  rpcUrl: string
): Promise<string> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const feeData = await provider.getFeeData();
  
  // Estimate gas
  const gasEstimate = await provider.estimateGas({
    to,
    data
  });

  // Calculate total cost
  if (!feeData.gasPrice) {
    throw new Error('Gas price not available');
  }

  const gasCost = gasEstimate * feeData.gasPrice;
  
  return gasCost.toString();
}

