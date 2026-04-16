import BaseHeader from "../shared/BaseHeader";
import { useMarketStats } from "@/hooks/market/useMarketStats";

const MktHeader = () => {
  const { stats, loading } = useMarketStats();

  return (
    <BaseHeader
      title="Kaleido Marketplace"
      description="Explore a world of lending and borrowing possibilities—find the perfect match for your financial needs and let your assets work smarter for you."
      showStats={true}
      type="market"
      backgroundImage="/banners/marketplaceheaderbg.png"
      backgroundOverlay={false}
      loading={loading}
      statsData={{
        totalPooledKLD: stats.totalTVL.toString(),
        totalStakers: stats.serviceRequests,
        userKldDeposit: stats.totalVolume.toString(),
        fees24h: stats.revenue.toString(),
      }}
    />
  );
};

export default MktHeader;
