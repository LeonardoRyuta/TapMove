/**
 * Configuration for the tap trading market on Movement testnet
 */

// Movement testnet RPC endpoint
export const MOVEMENT_NODE_URL = "https://testnet.movementnetwork.xyz/v1";

// Contract deployment addresses
export const MODULE_ADDRESS = "0x92c1c3e45c1b40d8902e793b73c8712002200318bd12bb3c289da7345110755c";
export const MODULE_NAME = "tap_market";
export const MARKET_ADMIN_ADDRESS = "0x92c1c3e45c1b40d8902e793b73c8712002200318bd12bb3c289da7345110755c";
export const COIN_TYPE = "0x1::aptos_coin::AptosCoin";

// Grid configuration
export const NUM_PRICE_BUCKETS = 21;
export const MID_PRICE_BUCKET = 10;
export const TIME_BUCKET_SECONDS = 10;
export const LOCKED_COLUMNS_AHEAD = 1;
export const MAX_EXPIRY_BUCKETS_AHEAD = 20;

// Bet size limits (in coin units - adjust based on your coin's decimals)
export const MIN_BET_SIZE = 100_000n;      // 0.001 coins (assuming 8 decimals)
export const MAX_BET_SIZE = 1_000_000_000n; // 10 coins

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
