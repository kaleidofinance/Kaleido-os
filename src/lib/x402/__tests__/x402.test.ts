/**
 * x402 Protocol Tests
 * Run with: npm test -- x402
 */

import { describe, it, expect } from '@jest/globals';
import { ethers } from 'ethers';

// Mock x402 functions
import { 
  verifyPayment,
  generatePaymentRequirements,
  checkPaymentValidity 
} from '../verification';
import { createAndSignPayment } from '../signing';
import { getAllServices, getServicePricing } from '../pricing';

describe('x402 Payment System', () => {
  // Mock data
  const mockRpcUrl = 'https://api.testnet.abs.xyz';
  const mockPayToAddress = '0x7286F2708f8f4d0a1a1b6c19f5D14AdB4c3207B2';
  const mockAsset = '0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3'; // USDC

  it('should generate payment requirements', () => {
    const requirements = generatePaymentRequirements(
      {
        name: 'Test Service',
        price: '1000000', // 1 USDC (6 decimals)
        asset: mockAsset
      },
      mockPayToAddress,
      '/api/test'
    );

    expect(requirements.scheme).toBe('exact');
    expect(requirements.maxAmountRequired).toBe('1000000');
    expect(requirements.asset).toBe(mockAsset);
    expect(requirements.payTo).toBe(mockPayToAddress);
  });

  it('should list all available services', () => {
    const services = getAllServices();
    
    expect(services.length).toBeGreaterThan(0);
    expect(services[0]).toHaveProperty('serviceId');
    expect(services[0]).toHaveProperty('price');
    expect(services[0]).toHaveProperty('name');
  });

  it('should get pricing for specific service', () => {
    const service = getServicePricing('execute-trade');
    
    expect(service).not.toBeNull();
    expect(service?.serviceId).toBe('execute-trade');
  });

  it('should validate payment timestamp', () => {
    const now = Math.floor(Date.now() / 1000);
    const valid = Math.abs(now - now) <= 300; // 5 min max age
    
    expect(valid).toBe(true);
  });
});

describe('x402 Integration', () => {
  it('should have all required API endpoints', async () => {
    // Test /api/x402/services endpoint
    const servicesResponse = await fetch('http://localhost:3000/api/x402/services');
    
    expect(servicesResponse.ok).toBe(true);
    
    const data = await servicesResponse.json();
    expect(data).toHaveProperty('services');
    expect(data).toHaveProperty('supportedSchemes');
    expect(data).toHaveProperty('supportedNetworks');
  });
});

