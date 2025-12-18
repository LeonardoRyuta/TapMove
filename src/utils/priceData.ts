/**
 * Utility functions for generating mock price data for chart visualization
 */

export interface PricePoint {
  timestamp: number; // Unix timestamp in seconds
  price: number;
}

/**
 * Generate realistic-looking price data using a random walk with drift
 * 
 * @param startTime - Starting timestamp in seconds
 * @param endTime - Ending timestamp in seconds  
 * @param intervalSeconds - Time between data points
 * @param startPrice - Initial price
 * @param volatility - Price volatility (0.01 = 1% per interval)
 * @returns Array of price points
 */
export function generatePriceData(
  startTime: number,
  endTime: number,
  intervalSeconds: number = 5,
  startPrice: number = 100,
  volatility: number = 0.005
): PricePoint[] {
  const points: PricePoint[] = [];
  let currentPrice = startPrice;
  
  for (let timestamp = startTime; timestamp <= endTime; timestamp += intervalSeconds) {
    points.push({
      timestamp,
      price: currentPrice,
    });
    
    // Random walk: drift + random component
    const drift = 0.0001; // Slight upward bias
    const randomChange = (Math.random() - 0.5) * 2 * volatility;
    const priceChange = (drift + randomChange) * currentPrice;
    
    currentPrice = Math.max(currentPrice + priceChange, startPrice * 0.5); // Floor at 50% of start
    currentPrice = Math.min(currentPrice, startPrice * 2); // Cap at 200% of start
  }
  
  return points;
}

/**
 * Generate live updating price data
 * This creates a data stream that updates in real-time
 * 
 * @param historySeconds - How many seconds of historical data to show
 * @param updateCallback - Callback fired when new data is available
 * @param intervalMs - Update interval in milliseconds
 * @returns Cleanup function to stop updates
 */
export function startLivePriceStream(
  historySeconds: number,
  updateCallback: (data: PricePoint[]) => void,
  intervalMs: number = 1000
): () => void {
  const currentTime = Math.floor(Date.now() / 1000);
  const startTime = currentTime - historySeconds;
  
  // Generate initial historical data
  let priceData = generatePriceData(startTime, currentTime, 5, 100, 0.005);
  updateCallback([...priceData]);
  
  // Update with new points periodically
  const interval = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    const lastPrice = priceData.length > 0 ? priceData[priceData.length - 1].price : 100;
    
    // Generate next point
    const volatility = 0.005;
    const drift = 0.0001;
    const randomChange = (Math.random() - 0.5) * 2 * volatility;
    const priceChange = (drift + randomChange) * lastPrice;
    const newPrice = Math.max(lastPrice + priceChange, 50);
    
    priceData.push({
      timestamp: now,
      price: newPrice,
    });
    
    // Keep only recent data (prune old points)
    const cutoffTime = now - historySeconds;
    priceData = priceData.filter(p => p.timestamp >= cutoffTime);
    
    updateCallback([...priceData]);
  }, intervalMs);
  
  // Return cleanup function
  return () => clearInterval(interval);
}
