"use client";

import { useEffect, useState } from 'react';
import { FiZap, FiDollarSign, FiCheck } from 'react-icons/fi';
import { ethers } from 'ethers';

interface ServicePricing {
  serviceId: string;
  name: string;
  description: string;
  price: string;
  asset: string;
  unit: string;
}

export function X402ServicesPanel() {
  const [services, setServices] = useState<ServicePricing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchServices();
  }, []);

  const fetchServices = async () => {
    try {
      const response = await fetch('/api/x402/services');
      const data = await response.json();
      setServices(data.services || []);
    } catch (error) {
      console.error('Error fetching services:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: string) => {
    // Assuming 6 decimals for USDC
    const amount = ethers.formatUnits(price, 6);
    return parseFloat(amount).toFixed(2);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00ff6e]"></div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="bg-black/40 backdrop-blur-sm rounded-xl border border-[#00ff6e]/30 p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-[#00ff6e]/10 rounded-lg">
            <FiZap className="w-6 h-6 text-[#00ff6e]" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">AI Agent Services</h2>
            <p className="text-gray-400 text-sm">Powered by x402 Protocol</p>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-[#00ff6e]/10 border border-[#00ff6e]/30 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-300">
            <strong className="text-[#00ff6e]">x402</strong> enables agent-to-agent payments. 
            Autonomous agents can pay for services using blockchain payments with <strong className="text-[#00ff6e]">NO</strong> intermediaries.
          </p>
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {services.map((service) => (
            <div
              key={service.serviceId}
              className="group relative bg-gradient-to-br from-black/60 to-black/40 border border-[#00ff6e]/20 rounded-lg p-5 hover:border-[#00ff6e]/50 transition-all duration-300 hover:scale-[1.02]"
            >
              {/* Service Badge */}
              <div className="absolute top-3 right-3">
                <div className="flex items-center gap-1 px-2 py-1 bg-[#00ff6e]/10 rounded-full">
                  <FiDollarSign className="w-3 h-3 text-[#00ff6e]" />
                  <span className="text-xs font-semibold text-[#00ff6e]">
                    {formatPrice(service.price)} USDC
                  </span>
                </div>
              </div>

              {/* Service Info */}
              <div className="mt-1">
                <h3 className="text-lg font-semibold text-white mb-2 pr-16">
                  {service.name}
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  {service.description}
                </p>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{service.unit}</span>
                  <span>•</span>
                  <span className="text-[#00ff6e]">x402</span>
                </div>
              </div>

              {/* Hover Effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#00ff6e]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg pointer-events-none" />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-6 pt-6 border-t border-[#00ff6e]/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <FiCheck className="w-4 h-4 text-[#00ff6e]" />
              <span>{services.length} services available</span>
            </div>
            <a
              href="https://github.com/coinbase/x402"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#00ff6e] hover:underline"
            >
              Learn more about x402 →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

