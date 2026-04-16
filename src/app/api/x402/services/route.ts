/**
 * x402 Available Services Endpoint
 * GET /api/x402/services
 */

import { NextResponse } from 'next/server';
import { getAllServices } from '@/lib/x402/pricing';
import type { SupportedServicesResponse } from '@/lib/x402/types';

export async function GET() {
  try {
    const services = getAllServices();
    
    const response: SupportedServicesResponse = {
      services,
      supportedSchemes: ['exact'],
      supportedNetworks: ['abstract-testnet']
    };

    return NextResponse.json(response);
    
  } catch (error: any) {
    console.error('Error getting services:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

