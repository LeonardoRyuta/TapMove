/**
 * Cell multiplier calculation matching the Move contract
 * 
 * This module mirrors the on-chain compute_multiplier_bps logic from
 * tap_market::tap_market to ensure frontend and contract stay in sync.
 */

// Contract constants (in basis points, 10_000 = 1.0x)
const BASE_MULT_BPS = 10_500;      // 1.05x at mid, earliest expiry
const DISTANCE_STEP_BPS = 600;     // +0.06x per price bucket from center
const TIME_STEP_BPS = 800;         // +0.08x per extra time bucket beyond minimum
const MAX_MULT_BPS = 100_000;      // 10.0x cap

export interface MultiplierParams {
  numPriceBuckets: number;
  midPriceBucket: number;
  lockedColumnsAhead: number;
  priceBucket: number;    // row index
  expiryBucket: number;   // time bucket index for this column
  currentBucket: number;  // floor(nowSeconds / timeBucketSeconds)
}

/**
 * Compute cell multiplier in basis points (10_000 = 1.0x)
 * 
 * Matches the Move contract's compute_multiplier_bps function exactly:
 * - Start from BASE_MULT_BPS (1.05x)
 * - Add DISTANCE_STEP_BPS (0.06x) for each row away from mid
 * - Add TIME_STEP_BPS (0.08x) for each extra time bucket beyond first bettable
 * - Clamp between 1.0x and MAX_MULT_BPS (10.0x)
 * 
 * @param params - Grid position and market configuration
 * @returns Multiplier in basis points
 */
export function computeMultiplierBps(params: MultiplierParams): number {
  const {
    midPriceBucket,
    lockedColumnsAhead,
    priceBucket,
    expiryBucket,
    currentBucket,
  } = params;

  const mid = midPriceBucket;
  const bucket = priceBucket;

  // Vertical distance from mid row
  const priceDistance = bucket > mid ? bucket - mid : mid - bucket;

  // Horizontal distance from "now"
  const timeDistance = expiryBucket - currentBucket;

  // Earliest allowed offset: locked_columns_ahead + 1
  const minTimeDistance = lockedColumnsAhead + 1;

  // Bonus only for being further than the minimum bettable column
  const timeBonusBps =
    timeDistance > minTimeDistance
      ? (timeDistance - minTimeDistance) * TIME_STEP_BPS
      : 0;

  const rawMultBps =
    BASE_MULT_BPS + priceDistance * DISTANCE_STEP_BPS + timeBonusBps;

  // Clamp to [1.0x, MAX_MULT_BPS]
  const clamped =
    rawMultBps < 10_000
      ? 10_000
      : rawMultBps > MAX_MULT_BPS
      ? MAX_MULT_BPS
      : rawMultBps;

  return clamped;
}

/**
 * Format multiplier from basis points to human-readable string
 * 
 * @param multBps - Multiplier in basis points (10_000 = 1.0x)
 * @returns Formatted string like "1.73x"
 */
export function formatMultiplier(multBps: number): string {
  return (multBps / 10_000).toFixed(2) + 'x';
}

/**
 * Convenience function: compute and format in one call
 * 
 * @param params - Grid position and market configuration
 * @returns Formatted multiplier string
 */
export function getMultiplierLabel(params: MultiplierParams): string {
  const multBps = computeMultiplierBps(params);
  return formatMultiplier(multBps);
}

/**
 * Compute the current time bucket from current timestamp
 * 
 * @param nowSeconds - Current Unix timestamp in seconds
 * @param timeBucketSeconds - Duration of each time bucket
 * @returns Current bucket index
 */
export function getCurrentBucket(nowSeconds: number, timeBucketSeconds: number): number {
  return Math.floor(nowSeconds / timeBucketSeconds);
}

/**
 * Compute the expiry bucket for a grid column
 * 
 * @param currentBucket - Current time bucket
 * @param lockedColumnsAhead - Number of locked columns
 * @param colIndex - Column index (0 = first bettable column)
 * @returns Expiry bucket index
 */
export function getExpiryBucket(
  currentBucket: number,
  lockedColumnsAhead: number,
  colIndex: number
): number {
  return currentBucket + lockedColumnsAhead + 1 + colIndex;
}
