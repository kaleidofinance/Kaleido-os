"use client";

import { X402ServicesPanel } from '@/components/x402/X402ServicesPanel';
import { useActiveAccount } from 'thirdweb/react';
import { formatAddress } from '@/constants/utils/formatAddress';

export default function X402TestPage() {
  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-black to-gray-950 pb-20">
      {/* Header */}
      <div className="border-b border-[#00ff6e]/20 bg-black/40 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">
                x402 Agent Services
              </h1>
              <p className="text-gray-400">
                Test and explore monetized AI agent services
              </p>
            </div>
            {address && (
              <div className="text-right">
                <p className="text-sm text-gray-400 mb-1">Connected Wallet</p>
                <p className="text-[#00ff6e] font-mono text-sm">
                  {formatAddress(address)}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <X402ServicesPanel />
      </div>

      {/* Info Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-black/40 backdrop-blur-sm rounded-xl border border-[#00ff6e]/30 p-6">
          <h3 className="text-xl font-semibold text-white mb-4">
            How Agent-to-Agent Payments Work
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[#00ff6e]/10 flex items-center justify-center text-[#00ff6e] font-bold">
                  1
                </div>
                <h4 className="font-semibold text-white">Agent Requests Service</h4>
              </div>
              <p className="text-sm text-gray-400">
                An autonomous agent makes a payment-enabled request to Kaleido AI services
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[#00ff6e]/10 flex items-center justify-center text-[#00ff6e] font-bold">
                  2
                </div>
                <h4 className="font-semibold text-white">Payment Verification</h4>
              </div>
              <p className="text-sm text-gray-400">
                x402 protocol verifies the EIP-712 signature and payment on-chain
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[#00ff6e]/10 flex items-center justify-center text-[#00ff6e] font-bold">
                  3
                </div>
                <h4 className="font-semibold text-white">Service Execution</h4>
              </div>
              <p className="text-sm text-gray-400">
                If valid, the service executes and returns results with transaction receipt
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Test Endpoints Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-black/40 backdrop-blur-sm rounded-xl border border-[#00ff6e]/30 p-6">
          <h3 className="text-xl font-semibold text-white mb-4">
            Test Endpoints
          </h3>
          <div className="space-y-3">
            <div className="bg-black/60 rounded-lg p-4 border border-[#00ff6e]/20">
              <p className="text-sm text-gray-400 mb-2">Get Available Services</p>
              <code className="text-[#00ff6e] text-sm break-all">
                GET /api/x402/services
              </code>
            </div>
            <div className="bg-black/60 rounded-lg p-4 border border-[#00ff6e]/20">
              <p className="text-sm text-gray-400 mb-2">Verify Payment</p>
              <code className="text-[#00ff6e] text-sm break-all">
                POST /api/x402/verify
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

