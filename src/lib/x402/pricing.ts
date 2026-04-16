/**
 * x402 Service Pricing Configuration
 * Defines prices for Kaleido AI services
 */

import { ethers } from 'ethers';
import type { ServicePricing } from './types';

// Contract addresses (Abstract Testnet)
const USDC_ADDRESS = '0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3';
const KFUSD_ADDRESS = '0x913f3354942366809A05e89D288cCE60d87d7348'; // Updated

/**
 * Kaleido AI Service Pricing Catalog
 */
export const KALEIDO_SERVICES: Record<string, ServicePricing> = {
  // Trade Execution Service
  'execute-trade': {
    serviceId: 'execute-trade',
    name: 'Execute Trade',
    description: 'Execute an optimal token swap on Kaleido DEX',
    price: ethers.parseUnits('0.1', 6).toString(), // 0.1 USDC
    asset: USDC_ADDRESS,
    unit: 'per execution'
  },

  // Lending Optimization Service
  'optimize-lending': {
    serviceId: 'optimize-lending',
    name: 'Lending Optimization',
    description: 'Optimize lending strategy based on market conditions',
    price: ethers.parseUnits('0.05', 6).toString(), // 0.05 USDC
    asset: USDC_ADDRESS,
    unit: 'per optimization'
  },

  // Portfolio Rebalancing Service
  'rebalance-portfolio': {
    serviceId: 'rebalance-portfolio',
    name: 'Portfolio Rebalancing',
    description: 'Automatically rebalance portfolio for optimal returns',
    price: ethers.parseUnits('0.15', 6).toString(), // 0.15 USDC
    asset: USDC_ADDRESS,
    unit: 'per rebalancing'
  },

  // Risk Analysis Service
  'risk-analysis': {
    serviceId: 'risk-analysis',
    name: 'Risk Analysis',
    description: 'Comprehensive risk analysis for DeFi positions',
    price: ethers.parseUnits('0.02', 6).toString(), // 0.02 USDC
    asset: USDC_ADDRESS,
    unit: 'per analysis'
  },

  // Liquidity Management Service
  'manage-liquidity': {
    serviceId: 'manage-liquidity',
    name: 'Liquidity Management',
    description: 'Optimize liquidity pool positions and fees',
    price: ethers.parseUnits('0.08', 6).toString(), // 0.08 USDC
    asset: USDC_ADDRESS,
    unit: 'per management action'
  },

  // Stablecoin Mint/Redeem Service
  'stablecoin-operation': {
    serviceId: 'stablecoin-operation',
    name: 'Stablecoin Operations',
    description: 'Mint or redeem kfUSD with optimal collateral',
    price: ethers.parseUnits('0.03', 6).toString(), // 0.03 USDC
    asset: USDC_ADDRESS,
    unit: 'per operation'
  },

  // Lending Analytics Service
  'lending-analytics': {
    serviceId: 'lending-analytics',
    name: 'Lending Analytics',
    description: 'Detailed analytics and insights for lending positions',
    price: ethers.parseUnits('0.01', 6).toString(), // 0.01 USDC
    asset: USDC_ADDRESS,
    unit: 'per report'
  },

  // Yield Optimization Service
  'yield-optimization': {
    serviceId: 'yield-optimization',
    name: 'Yield Optimization',
    description: 'Find and execute best yield opportunities',
    price: ethers.parseUnits('0.12', 6).toString(), // 0.12 USDC
    asset: USDC_ADDRESS,
    unit: 'per optimization'
  }
};

/**
 * Get pricing for a specific service
 */
export function getServicePricing(serviceId: string): ServicePricing | null {
  return KALEIDO_SERVICES[serviceId] || null;
}

/**
 * Get all available services
 */
export function getAllServices(): ServicePricing[] {
  return Object.values(KALEIDO_SERVICES);
}

/**
 * Get price in human-readable format
 */
export function formatPrice(price: string, decimals: number = 6): string {
  return ethers.formatUnits(price, decimals);
}

/**
 * Payment address (where agents pay to)
 * In production, this should be a controlled multisig or treasury
 */
export const KALEIDO_PAYMENT_ADDRESS = process.env.KALEIDO_PAYMENT_ADDRESS || 
  '0x7286F2708f8f4d0a1a1b6c19f5D14AdB4c3207B2'; // Diamond contract address


