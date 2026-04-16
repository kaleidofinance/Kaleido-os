import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/supabaseClient";

export interface MarketStats {
  totalTVL: number;
  totalVolume: number;
  serviceRequests: number;
  revenue: number;
}

export const useMarketStats = () => {
  const [stats, setStats] = useState<MarketStats>({
    totalTVL: 0,
    totalVolume: 0,
    serviceRequests: 0,
    revenue: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);

        // Fetch TVL: Sum of amount from OPEN listings and OPEN requests
        const { data: openListings, error: listingsError } = await supabase
          .from("kaleido_listings")
          .select("amount")
          .eq("status", "OPEN");

        const { data: openRequests, error: requestsError } = await supabase
          .from("kaleido_requests")
          .select("amount")
          .eq("status", "OPEN");

        if (listingsError || requestsError) throw listingsError || requestsError;

        const tvl = [
          ...(openListings || []),
          ...(openRequests || []),
        ].reduce((sum, item) => sum + Number(item.amount || 0), 0);

        // Fetch Volume and Service Requests: Sum of amount from SERVICED requests
        const { data: servicedRequests, error: servicedError } = await supabase
          .from("kaleido_requests")
          .select("amount")
          .eq("status", "SERVICED");

        if (servicedError) throw servicedError;

        const volume = (servicedRequests || []).reduce(
          (sum, item) => sum + Number(item.amount || 0),
          0
        );
        const requestCount = (servicedRequests || []).length;

        // Revenue is 0.3% of volume
        const revenue = volume * 0.003;

        setStats({
          totalTVL: tvl,
          totalVolume: volume,
          serviceRequests: requestCount,
          revenue: revenue,
        });
      } catch (error) {
        console.error("Error fetching market stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    
    // Set up polling for real-time updates (optional, every 60s)
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, []);

  return { stats, loading };
};
