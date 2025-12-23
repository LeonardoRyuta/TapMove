/**
 * Shared TypeScript types for the TapMove application
 */

/**
 * Wallet connection state
 */
export interface WalletState {
  address: string | null;
  balance: string;
  isConnected: boolean;
  isLoading: boolean;
}

/**
 * Status of a placed bet
 */
export type BetStatus =
  | 'draft'              // Bet is being prepared
  | 'submitting'         // Transaction is being submitted
  | 'placed'             // Bet successfully placed on-chain
  | 'placed_missing_id'  // Bet placed but ID extraction failed
  | 'settle_ready'       // Bet is ready to be settled
  | 'settling'           // Settlement transaction in progress
  | 'won'                // Bet won and payout received
  | 'lost'               // Bet lost
  | 'failed';            // Transaction failed

/**
 * Bet data structure
 */
export interface Bet {
  localId: string;                    // Local unique ID for tracking
  betId?: string | number;            // On-chain bet ID
  priceBucket: number;                // Price bucket (row index)
  expiryBucket: number;               // Expiry bucket (column index)
  expiryTimestampSecs: number;        // Unix timestamp when bet expires
  stakeOctas: string | number;        // Stake amount in octas
  multiplierBps: number;              // Multiplier in basis points (e.g., 10500 = 1.05x)
  status: BetStatus;                  // Current status of the bet
  txHash?: string;                    // Transaction hash
  placedAt: number;                   // Timestamp when bet was placed
  settlementAttempts: number;         // Number of settlement attempts
  error?: string;                     // Error message if any
  priceId?: string;                   // Pyth price feed ID for settlement
}

/**
 * Market state information
 */
export interface MarketState {
  currentBucket: number;
  nowSec: number;
  currentPrice: number | null;
  earliestAllowedExpiryBucket: number;
  maxAllowedExpiryBucket: number;
}

/**
 * Price point for charting
 */
export interface PricePoint {
  timestamp: number;
  price: number;
}

/**
 * Transaction result
 */
export interface TransactionResult {
  success: boolean;
  txHash?: string;
  error?: string;
}
