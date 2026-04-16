/**
 * x402 Protocol Type Definitions
 * Based on: https://github.com/coinbase/x402
 */

/**
 * Payment scheme types supported
 */
export type PaymentScheme = 'exact' | 'upto' | 'custom';

/**
 * Network configuration
 */
export interface NetworkConfig {
  networkId: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
}

/**
 * Payment Requirements - What the server accepts
 */
export interface PaymentRequirements {
  scheme: PaymentScheme;
  network: string;
  maxAmountRequired: string; // In atomic units
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string; // ERC20 address
  extra?: {
    name?: string;
    version?: string;
    [key: string]: any;
  } | null;
}

/**
 * Payment Required Response (402 response)
 */
export interface PaymentRequiredResponse {
  x402Version: number;
  accepts: PaymentRequirements[];
  error?: string;
}

/**
 * EIP-712 Payment Signature Domain
 */
export interface PaymentDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

/**
 * EIP-712 Payment Types
 */
export interface PaymentTypes {
  EIP712Domain: Array<{ name: string; type: string }>;
  Payment: Array<{ name: string; type: string }>;
}

/**
 * Payment Payload Structure
 */
export interface PaymentPayload {
  x402Version: number;
  scheme: PaymentScheme;
  network: string;
  payload: ExactPaymentPayload;
}

/**
 * Exact payment payload (first supported scheme)
 */
export interface ExactPaymentPayload {
  amount: string;
  asset: string;
  payTo: string;
  timestamp: number;
  nonce: string;
  signature: {
    r: string;
    s: string;
    v: number;
  };
}

/**
 * Payment Verification Result
 */
export interface VerificationResult {
  isValid: boolean;
  invalidReason?: string;
  metadata?: {
    signer: string;
    amount: string;
    timestamp: number;
  };
}

/**
 * Payment Settlement Result
 */
export interface SettlementResult {
  success: boolean;
  error?: string;
  txHash?: string;
  networkId?: string;
}

/**
 * Service Pricing
 */
export interface ServicePricing {
  serviceId: string;
  name: string;
  description: string;
  price: string; // In atomic units (wei)
  asset: string; // Token address
  unit: string; // Unit description (per call, per hour, etc.)
}

/**
 * Supported Services Response
 */
export interface SupportedServicesResponse {
  services: ServicePricing[];
  supportedSchemes: PaymentScheme[];
  supportedNetworks: string[];
}

/**
 * Kaleido-specific: Transaction Execution Request
 */
export interface TransactionExecutionRequest {
  functionId: string;
  params: Record<string, any>;
  payment: PaymentPayload;
}

/**
 * Kaleido-specific: Transaction Execution Response
 */
export interface TransactionExecutionResponse {
  success: boolean;
  result?: any;
  txHash?: string;
  error?: string;
  paymentReceipt?: {
    txHash: string;
    networkId: string;
    amount: string;
    asset: string;
  };
}

