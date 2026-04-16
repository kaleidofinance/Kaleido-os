import PageBanner from "@/components/banner/pageBanner";
import { ArrowLeftRight, Clock, DollarSign, Minus, Shield } from "lucide-react";

export function RemoveLiquidityPageBanner() {
  return (
    <PageBanner
      title="Remove Liquidity"
      description="Withdraw your liquidity from Abstract Chain's AMM pools and claim your earned rewards."
      icon={Minus}
      gradient="from-[#1a2f1a] via-[#0d1b0d] to-[#0a140a]"
    >
      {/* Key features */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto mb-6">
        <div className="bg-black/20 backdrop-blur-sm border border-[#00ff99]/20 rounded-xl p-4 text-left">
          <div className="flex items-center mb-2">
            <div className="w-8 h-8 bg-[#00ff99]/20 rounded-lg flex items-center justify-center mr-3">
              <ArrowLeftRight className="w-4 h-4 text-[#00ff99]" />
            </div>
            <h3 className="text-base font-semibold text-white">
              Flexible Withdrawal
            </h3>
          </div>
          <p className="text-gray-300 text-sm">
            Remove partial or complete liquidity from your Abstract Chain pools
          </p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-[#00ff99]/20 rounded-xl p-4 text-left">
          <div className="flex items-center mb-2">
            <div className="w-8 h-8 bg-[#00ff99]/20 rounded-lg flex items-center justify-center mr-3">
              <DollarSign className="w-4 h-4 text-[#00ff99]" />
            </div>
            <h3 className="text-base font-semibold text-white">
              Claim Rewards
            </h3>
          </div>
          <p className="text-gray-300 text-sm">
            Collect all accumulated trading fees and LP rewards earned
          </p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-[#00ff99]/20 rounded-xl p-4 text-left">
          <div className="flex items-center mb-2">
            <div className="w-8 h-8 bg-[#00ff99]/20 rounded-lg flex items-center justify-center mr-3">
              <Clock className="w-4 h-4 text-[#00ff99]" />
            </div>
            <h3 className="text-base font-semibold text-white">
              Instant Processing
            </h3>
          </div>
          <p className="text-gray-300 text-sm">
            No lock-up periods - withdraw your liquidity anytime you need
          </p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-[#00ff99]/20 rounded-xl p-4 text-left">
          <div className="flex items-center mb-2">
            <div className="w-8 h-8 bg-[#00ff99]/20 rounded-lg flex items-center justify-center mr-3">
              <Shield className="w-4 h-4 text-[#00ff99]" />
            </div>
            <h3 className="text-base font-semibold text-white">
              Secure Process
            </h3>
          </div>
          <p className="text-gray-300 text-sm">
            Safe and secure liquidity removal on Abstract Chain protocol
          </p>
        </div>
      </div>
    </PageBanner>
  );
}
