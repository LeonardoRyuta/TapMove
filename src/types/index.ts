/**
 * TypeScript type definitions for TapMove
 * 
 * These types mirror the Move contract structures and provide
 * type safety throughout the frontend application.
 */

import { Account } from "@aptos-labs/ts-sdk";

// ============================================================================
// Contract Types (matching Move structs)
// ============================================================================

/**
 * Represents a bet placed by a user
 * Mirrors: struct Bet has store { ... }
 */
export interface Bet {
  user: string; // address
  stake: string; // u64 as string
  multiplier_bps: string; // u64 as string (10000 = 1.00x)
  price_bucket: number; // u8
  expiry_bucket: string; // u64 as string
  settled: boolean;
  won: boolean;
}

/**
 * Market configuration and state
 * Mirrors: struct Market<phantom CoinType> has key { ... }
 * 
 * Note: This is stored on-chain. Frontend doesn't directly read it yet
 * (no view functions in contract), so we track config separately.
 */
export interface Market {
  admin: string; // address
  num_price_buckets: number; // u8
  mid_price_bucket: number; // u8
  time_bucket_seconds: number; // u64
  max_expiry_buckets_ahead: number; // u64
  locked_columns_ahead: number; // u64
  min_bet_size: string; // u64 as string
  max_bet_size: string; // u64 as string
  max_open_bets_per_user: number; // u64
  price_feed_id: Uint8Array; // vector<u8>
  next_bet_id: string; // u64 as string
}

// ============================================================================
// Frontend Types
// ============================================================================

/**
 * Grid cell state for UI rendering
 */
export interface CellState {
  rowIndex: number;
  columnIndex: number;
  priceBucket: number;
  expiryBucket: number;
  isLocked: boolean;
  isCurrent: boolean;
  isBettable: boolean;
  multiplier: number;
}

/**
 * User's bet placement request (UI coordinates)
 */
export interface BetRequest {
  rowIndex: number; // 0 to numPriceBuckets-1
  columnIndex: number; // 0 to visibleColumns-1
  stakeAmount: string; // Amount in coin units
}

/**
 * Bet result after placement
 */
export interface BetResult {
  success: boolean;
  txHash?: string;
  error?: string;
  betId?: string;
}

/**
 * Grid state information
 */
export interface GridState {
  currentBucket: number;
  earliestBettableBucket: number;
  lockedColumnsAhead: number;
  visibleColumns: number;
  numPriceBuckets: number;
  midPriceBucket: number;
}

/**
 * Transaction status
 */
export enum TransactionStatus {
  IDLE = "idle",
  PENDING = "pending",
  CONFIRMING = "confirming",
  SUCCESS = "success",
  FAILED = "failed",
}

/**
 * Transaction state
 */
export interface TransactionState {
  status: TransactionStatus;
  hash?: string;
  error?: string;
  timestamp?: number;
}

// ============================================================================
// Function Argument Types (for contract calls)
// ============================================================================

/**
 * Arguments for place_bet function
 */
export interface PlaceBetArgs {
  priceBucket: number; // u8
  expiryTimestampSecs: number; // u64
  stakeAmount: string; // u64 as string
}

/**
 * Arguments for init_market function
 */
export interface InitMarketArgs {
  numPriceBuckets: number; // u8
  midPriceBucket: number; // u8
  timeBucketSeconds: number; // u64
  maxExpiryBucketsAhead: number; // u64
  lockedColumnsAhead: number; // u64
  minBetSize: number; // u64
  maxBetSize: number; // u64
  maxOpenBetsPerUser: number; // u64
  anchorPriceMagnitude: string; // u64 as string
  anchorPriceNegative: boolean;
  bucketSizeMagnitude: string; // u64 as string
  bucketSizeNegative: boolean;
  priceFeedId: Uint8Array; // vector<u8>
  initialHouseLiquidityAmount: string; // u64 as string
}

/**
 * Arguments for settle_bet function
 */
export interface SettleBetArgs {
  betId: string; // u64 as string
  pythPriceUpdate: Uint8Array[]; // vector<vector<u8>>
}

// ============================================================================
// Wallet Types
// ============================================================================

/**
 * Wallet connection state
 */
export interface WalletState {
  connected: boolean;
  account: Account | null;
  address: string | null;
  balance: string | null; // Coin balance as string
}

/**
 * Wallet provider interface
 */
export interface WalletProvider {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  getAccount: () => Promise<Account | null>;
  signTransaction: (payload: any) => Promise<string>;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Market configuration (client-side)
 */
export interface MarketConfig {
  marketAdminAddress: string;
  coinType: string;
  moduleAddress: string;
  moduleName: string;
  numPriceBuckets: number;
  midPriceBucket: number;
  timeBucketSeconds: number;
  lockedColumnsAhead: number;
  maxExpiryBucketsAhead: number;
  minBetSize: number;
  maxBetSize: number;
  maxOpenBetsPerUser: number;
}

/**
 * UI configuration
 */
export interface UIConfig {
  visibleFutureColumns: number;
  gridRefreshIntervalMs: number;
  defaultStakeAmount: string;
  showMultipliers: boolean;
  enableSoundEffects: boolean;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Contract error codes
 */
export enum ContractError {
  NOT_ADMIN = 1,
  MARKET_ALREADY_INIT = 2,
  INVALID_PRICE_BUCKET = 3,
  BET_TOO_SMALL = 4,
  BET_TOO_LARGE = 5,
  EXPIRY_TOO_SOON = 6,
  EXPIRY_TOO_FAR = 7,
  COLUMN_LOCKED = 8,
  BET_ALREADY_SETTLED = 9,
  INVALID_BET_ID = 10,
  TOO_MANY_OPEN_BETS = 11,
  NO_MARKET = 12,
  HOUSE_INSUFFICIENT_LIQUIDITY = 13,
  INVALID_ARGUMENT = 14,
}

/**
 * Error with contract context
 */
export interface ContractErrorInfo {
  code: ContractError;
  message: string;
  details?: string;
}

// ============================================================================
// Event Types (for future indexing)
// ============================================================================

/**
 * Bet placed event (when we add events to contract)
 */
export interface BetPlacedEvent {
  betId: string;
  user: string;
  priceBucket: number;
  expiryBucket: string;
  stake: string;
  multiplierBps: string;
  timestamp: number;
}

/**
 * Bet settled event
 */
export interface BetSettledEvent {
  betId: string;
  user: string;
  won: boolean;
  payout: string;
  realizedPriceBucket: number;
  timestamp: number;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Time bucket info
 */
export interface TimeBucketInfo {
  bucketIndex: number;
  startTimestamp: number;
  endTimestamp: number;
  isCurrentBucket: boolean;
  isLocked: boolean;
  isBettable: boolean;
}

/**
 * Price bucket info
 */
export interface PriceBucketInfo {
  bucketIndex: number;
  priceMin: number;
  priceMax: number;
  isMidBucket: boolean;
  offsetFromMid: number;
}

// ============================================================================
// Hook Return Types
// ============================================================================

/**
 * Return type for useTapMarket hook
 */
export interface UseTapMarketReturn {
  placeBet: (params: BetRequest) => Promise<string>;
  isPlacing: boolean;
  error: string | null;
  clearError: () => void;
  lastTxHash: string | null;
}

/**
 * Return type for useGridState hook
 */
export interface UseGridStateReturn {
  currentBucket: number;
  earliestBettableBucket: number;
  lockedColumnsAhead: number;
  gridState: GridState;
  refresh: () => void;
}

/**
 * Return type for useWallet hook
 */
export interface UseWalletReturn {
  wallet: WalletState;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnecting: boolean;
  error: string | null;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if error is a contract error
 */
export function isContractError(error: any): error is ContractErrorInfo {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error
  );
}

/**
 * Check if a value is a valid stake amount
 */
export function isValidStakeAmount(
  value: string,
  config: MarketConfig
): boolean {
  try {
    const amount = BigInt(value);
    return (
      amount >= BigInt(config.minBetSize) &&
      amount <= BigInt(config.maxBetSize)
    );
  } catch {
    return false;
  }
}

/**
 * Check if a cell is bettable
 */
export function isCellBettable(cell: CellState): boolean {
  return !cell.isLocked && !cell.isCurrent;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Multiplier calculation constants
 */
export const MULTIPLIER_CONSTANTS = {
  BASE_MULT_BPS: 10500, // 1.05x
  DISTANCE_STEP_BPS: 600, // +0.06x per row
  TIME_STEP_BPS: 800, // +0.08x per column
  MAX_MULT_BPS: 100000, // 10x cap
  BPS_DIVISOR: 10000, // Convert BPS to decimal
} as const;

/**
 * Default values
 */
export const DEFAULTS = {
  STAKE_AMOUNT: "1000000",
  NUM_PRICE_BUCKETS: 15,
  MID_PRICE_BUCKET: 7,
  TIME_BUCKET_SECONDS: 10,
  LOCKED_COLUMNS_AHEAD: 1,
  VISIBLE_FUTURE_COLUMNS: 12,
} as const;
