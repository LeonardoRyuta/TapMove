/**
 * Configuration constants for the TapMarket contract on Movement testnet
 */

// Movement/Aptos testnet RPC endpoint
export const MOVEMENT_TESTNET_RPC = "https://testnet.movementnetwork.xyz/v1";

// The address where the Market<CoinType> resource is stored (admin address)
export const MARKET_ADMIN_ADDRESS = "0x92c1c3e45c1b40d8902e793b73c8712002200318bd12bb3c289da7345110755c";

// The coin type used for betting (Movement's native coin or a test token)
// Example: AptosCoin would be "0x1::aptos_coin::AptosCoin"
// Replace with your actual CoinType
export const COIN_TYPE = "0x1::aptos_coin::AptosCoin";

// Contract module address and name
export const MODULE_ADDRESS = "0x92c1c3e45c1b40d8902e793b73c8712002200318bd12bb3c289da7345110755c";
export const MODULE_NAME = "tap_market";

// Market configuration (should match what's on-chain)
export const MARKET_CONFIG = {
  numPriceBuckets: 15,
  midPriceBucket: 7,
  timeBucketSeconds: 10, // Each column = 10 seconds
  lockedColumnsAhead: 1, // Can't bet on current or next 1 column
  maxExpiryBucketsAhead: 100,
  minBetSize: 100_000, // 0.001 coins (assuming 8 decimals)
  maxBetSize: 1_000_000_000, // 10 coins
  maxOpenBetsPerUser: 50,
} as const;

// UI configuration
export const UI_CONFIG = {
  visibleFutureColumns: 12, // Show 12 future time columns
  gridRefreshIntervalMs: 1000, // Update current time every second
} as const;
