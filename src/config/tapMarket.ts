/**
 * Configuration for the tap trading market on Movement testnet
 */

// Movement testnet RPC endpoint
export const MOVEMENT_NODE_URL = "https://testnet.movementnetwork.xyz/v1";

// Contract deployment addresses
export const MODULE_ADDRESS = import.meta.env.VITE_MODULE_ADDRESS || "0xeab4141af6ec0892a42e321e30cde3d4358d7a495aa98078203190248d70c742";
export const MODULE_NAME = "tap_market";
export const MARKET_ADMIN_ADDRESS = import.meta.env.VITE_MODULE_ADDRESS || "0xeab4141af6ec0892a42e321e30cde3d4358d7a495aa98078203190248d70c742";
export const COIN_TYPE = "0x1::aptos_coin::AptosCoin";

// Grid configuration
export const NUM_PRICE_BUCKETS = 21;
export const MID_PRICE_BUCKET = 10;
export const TIME_BUCKET_SECONDS = 5;
export const LOCKED_COLUMNS_AHEAD = 1;
export const MAX_EXPIRY_BUCKETS_AHEAD = 20;

// Bet size limits (in octas - 1 MOVE = 100,000,000 octas)
export const MIN_BET_SIZE = 100_000n;      // 0.001 MOVE
export const MAX_BET_SIZE = 1_000_000_000n; // 10 MOVE

// UI configuration
export const NUM_VISIBLE_TIME_COLUMNS = 12;

/**
 * Compute the expiry timestamp for a given column index
 * 
 * @param columnIndex - UI column index (0 = first bettable column)
 * @returns Unix timestamp in seconds
 */
export function computeExpiryTimestampSecs(columnIndex: number): number {
  // Get current time in seconds
  const nowSec = Math.floor(Date.now() / 1000);
  
  // Calculate current bucket
  const currentBucket = Math.floor(nowSec / TIME_BUCKET_SECONDS);
  
  // First allowed bucket (accounting for locked columns)
  // Per contract: earliest_allowed_bucket = current_bucket + locked_columns_ahead + 1
  const firstAllowedBucket = currentBucket + LOCKED_COLUMNS_AHEAD + 1;
  
  // Target bucket for this column
  const expiryBucket = firstAllowedBucket + columnIndex;
  
  // Return timestamp at the start of the target bucket
  return expiryBucket * TIME_BUCKET_SECONDS;
}

/**
 * Get the current time bucket index
 */
export function getCurrentBucket(): number {
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.floor(nowSec / TIME_BUCKET_SECONDS);
}

/**
 * Get the first bettable bucket index
 */
export function getFirstBettableBucket(): number {
  const currentBucket = getCurrentBucket();
  return currentBucket + LOCKED_COLUMNS_AHEAD + 1;
}

/**
 * Map a price value to a bucket index
 * 
 * This uses the same logic as the price grid canvas to determine which
 * price bucket (row) a given price falls into.
 * 
 * The algorithm:
 * - We have a fixed grid with PRICE_PER_GRID spacing (e.g., $0.50)
 * - The current price determines which grid row is the "mid bucket"
 * - We calculate the offset from current price to the given price
 * - Then map that to a bucket index
 * 
 * @param price - The price to map (e.g., ETH price in dollars)
 * @param currentPrice - The current reference price
 * @param referencePrice - The Y-axis reference price (for grid alignment)
 * @param pricePerGrid - Price spacing per grid cell (default 0.5)
 * @param gridSize - Size of grid cells in pixels (default 50)
 * @returns Bucket index (0 to NUM_PRICE_BUCKETS - 1)
 */
export function mapPriceToBucket(
  price: number,
  currentPrice: number,
  referencePrice: number = Math.round(currentPrice),
  pricePerGrid: number = 0.5,
  gridSize: number = 50
): number {
  // Calculate Y position in grid coordinates for both prices
  const currentPriceY = ((referencePrice - currentPrice) / pricePerGrid) * gridSize;
  const targetPriceY = ((referencePrice - price) / pricePerGrid) * gridSize;
  
  // Calculate grid rows
  const currentPriceGridRow = Math.floor(currentPriceY / gridSize);
  const targetPriceGridRow = Math.floor(targetPriceY / gridSize);
  
  // Calculate bucket: mid bucket minus the row offset
  const rowOffsetFromCurrentPrice = targetPriceGridRow - currentPriceGridRow;
  const priceBucket = MID_PRICE_BUCKET - rowOffsetFromCurrentPrice;
  
  // Clamp to valid range
  return Math.max(0, Math.min(NUM_PRICE_BUCKETS - 1, priceBucket));
}
