/**
 * x402 Payment Verification Endpoint
 * POST /api/x402/verify
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyPayment } from '@/lib/x402/verification';
import type { PaymentRequirements } from '@/lib/x402/types';

// Abstract Testnet RPC URL
const RPC_URL = 'https://api.testnet.abs.xyz';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const { paymentHeader, requirements }: { 
      paymentHeader: string;
      requirements: PaymentRequirements;
    } = body;

    // Verify payment
    const result = await verifyPayment(paymentHeader, requirements, RPC_URL);

    return NextResponse.json(result);
    
  } catch (error: any) {
    console.error('x402 verification error:', error);
    return NextResponse.json(
      { 
        isValid: false,
        invalidReason: `Verification failed: ${error.message}`
      },
      { status: 500 }
    );
  }
}

