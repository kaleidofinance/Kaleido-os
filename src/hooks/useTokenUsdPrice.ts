import { useState, useEffect } from 'react';
import { IToken } from '@/constants/types/dex';

export const useTokenUsdPrice = (token: IToken | null) => {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchPrice = async () => {
      if (!token?.priceUrl) {
        setPrice(null);
        return;
      }

      try {
        setLoading(true);
        const response = await fetch(token.priceUrl);
        const data = await response.json();
        
        // Extract price from CoinGecko response structure: { "id": { "usd": 123.45, ... } }
        // The key in the response is usually the first key of the object
        const keys = Object.keys(data);
        if (keys.length > 0) {
          const firstKey = keys[0];
          const usdPrice = data[firstKey]?.usd;
          if (typeof usdPrice === 'number') {
            setPrice(usdPrice);
          }
        }
      } catch (error) {
        console.error(`Error fetching price for ${token.symbol}:`, error);
        setPrice(null);
      } finally {
        setLoading(false);
      }
    };

    fetchPrice();
    
    // Refresh every minute
    const interval = setInterval(fetchPrice, 60000);
    return () => clearInterval(interval);
  }, [token]);

  return { price, loading };
};
