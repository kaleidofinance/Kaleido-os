/**
 * x402 Payment Verification Logic
 */

import { ethers } from 'ethers';
import type { 
  PaymentPayload, 
  PaymentRequirements, 
  VerificationResult,
  ExactPaymentPayload
} from './types';

/**
 * Verify payment signature using EIP-712
 */
export async function verifyPayment(
  paymentHeader: string, // Base64 encoded X-PAYMENT header
  requirements: PaymentRequirements,
  rpcUrl: string
): Promise<VerificationResult> {
  try {
    // Decode base64 payment header
    const payment: PaymentPayload = JSON.parse(
      Buffer.from(paymentHeader, 'base64').toString('utf-8')
    );

    // Verify x402 version compatibility
    if (payment.x402Version !== 1) {
      return {
        isValid: false,
        invalidReason: `Unsupported x402 version: ${payment.x402Version}`
      };
    }

    // Verify scheme matches requirements
    if (payment.scheme !== requirements.scheme) {
      return {
        isValid: false,
        invalidReason: `Scheme mismatch: expected ${requirements.scheme}, got ${payment.scheme}`
      };
    }

    // Verify network matches
    if (payment.network !== requirements.network) {
      return {
        isValid: false,
        invalidReason: `Network mismatch: expected ${requirements.network}, got ${payment.network}`
      };
    }

    // Handle exact payment scheme
    if (payment.scheme === 'exact') {
      return await verifyExactPayment(
        payment.payload as ExactPaymentPayload,
        requirements,
        rpcUrl
      );
    }

    return {
      isValid: false,
      invalidReason: `Unsupported payment scheme: ${payment.scheme}`
    };

  } catch (error: any) {
    return {
      isValid: false,
      invalidReason: `Payment verification error: ${error.message}`
    };
  }
}

/**
 * Verify exact payment scheme
 */
async function verifyExactPayment(
  payload: ExactPaymentPayload,
  requirements: PaymentRequirements,
  rpcUrl: string
): Promise<VerificationResult> {
  try {
    // Validate amount meets minimum requirement
    const requiredAmount = BigInt(requirements.maxAmountRequired);
    const paidAmount = BigInt(payload.amount);

    if (paidAmount < requiredAmount) {
      return {
        isValid: false,
        invalidReason: `Insufficient payment: required ${requiredAmount}, got ${paidAmount}`
      };
    }

    // Validate asset matches
    if (payload.asset.toLowerCase() !== requirements.asset.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: `Asset mismatch`
      };
    }

    // Validate payTo address matches
    if (payload.payTo.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: `PayTo address mismatch`
      };
    }

    // Check timestamp (prevent replay attacks)
    const now = Math.floor(Date.now() / 1000);
    const maxAge = 300; // 5 minutes
    if (Math.abs(now - payload.timestamp) > maxAge) {
      return {
        isValid: false,
        invalidReason: `Payment timestamp expired or invalid`
      };
    }

    // Recover signer from signature
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    
    // Build EIP-712 typed data
    const domain = {
      name: 'Kaleido AI Services',
      version: '1',
      chainId: await provider.getNetwork().then(n => Number(n.chainId)),
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
      amount: payload.amount,
      asset: payload.asset,
      payTo: payload.payTo,
      timestamp: payload.timestamp,
      nonce: payload.nonce
    };

    // Recover signer
    const signerAddress = ethers.verifyTypedData(
      domain,
      types,
      value,
      {
        r: payload.signature.r,
        s: payload.signature.s,
        v: payload.signature.v
      }
    );

    return {
      isValid: true,
      metadata: {
        signer: signerAddress,
        amount: payload.amount,
        timestamp: payload.timestamp
      }
    };

  } catch (error: any) {
    return {
      isValid: false,
      invalidReason: `Signature verification failed: ${error.message}`
    };
  }
}

/**
 * Generate payment requirements for a service
 */
export function generatePaymentRequirements(
  service: { name: string; price: string; asset: string },
  payToAddress: string,
  resourceUrl: string
): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'abstract-testnet',
    maxAmountRequired: service.price,
    resource: resourceUrl,
    description: `Payment for ${service.name} on Kaleido`,
    mimeType: 'application/json',
    payTo: payToAddress,
    maxTimeoutSeconds: 300,
    asset: service.asset,
    extra: {
      name: 'Kaleido AI Services',
      version: '1.0'
    }
  };
}

/**
 * Check if a payment is valid for use (not already spent)
 * This would typically check against a database or on-chain state
 */
export async function checkPaymentValidity(
  payment: PaymentPayload,
  nonce: string
): Promise<boolean> {
  // In a real implementation, check:
  // 1. Nonce hasn't been used before
  // 2. Payment hasn't expired
  // 3. Signer has sufficient balance
  
  // For MVP, assume valid if signature checks out
  return true;
}

