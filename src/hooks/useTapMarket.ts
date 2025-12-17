/**
 * React hook for interacting with the TapMarket contract
 * 
 * This hook provides a simple interface for placing bets and handles:
 * - Converting UI coordinates (row/column) to contract parameters
 * - Loading states and error handling
 * - Integration with wallet provider
 */

import { useState, useCallback } from "react";
import { Account } from "@aptos-labs/ts-sdk";
import * as tapMarketClient from "../aptos/tapMarketClient";
import { MARKET_CONFIG } from "../aptos/config";

export interface PlaceBetParams {
  rowIndex: number; // Price bucket index (0 to numPriceBuckets - 1)
  columnIndex: number; // Time column index (0 = first bettable column)
  stakeAmount: string; // Amount in coin units (as string for precision)
}

export interface UseTapMarketReturn {
  placeBet: (params: PlaceBetParams) => Promise<string>;
  isPlacing: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Hook for placing bets on the tap market
 * 
 * @param account - Aptos account from wallet provider (e.g., Privy)
 * @returns Functions and state for placing bets
 */
export function useTapMarket(account: Account | null): UseTapMarketReturn {
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Place a bet by clicking on a grid cell
   * 
   * This converts the UI coordinates to contract parameters:
   * - rowIndex -> price_bucket (direct mapping)
   * - columnIndex -> expiry_timestamp_secs (calculated based on time buckets)
   */
  const placeBet = useCallback(
    async ({ rowIndex, columnIndex, stakeAmount }: PlaceBetParams): Promise<string> => {
      // Validate account
      if (!account) {
        const errorMsg = "Wallet not connected";
        setError(errorMsg);
        throw new Error(errorMsg);
      }

      // Validate inputs
      if (rowIndex < 0 || rowIndex >= MARKET_CONFIG.numPriceBuckets) {
        const errorMsg = `Invalid row index: ${rowIndex}`;
        setError(errorMsg);
        throw new Error(errorMsg);
      }

      if (columnIndex < 0) {
        const errorMsg = `Invalid column index: ${columnIndex}`;
        setError(errorMsg);
        throw new Error(errorMsg);
      }

      const stakeAmountNum = BigInt(stakeAmount);
      if (stakeAmountNum < BigInt(MARKET_CONFIG.minBetSize)) {
        const errorMsg = `Stake amount too small. Minimum: ${MARKET_CONFIG.minBetSize}`;
        setError(errorMsg);
        throw new Error(errorMsg);
      }

      if (stakeAmountNum > BigInt(MARKET_CONFIG.maxBetSize)) {
        const errorMsg = `Stake amount too large. Maximum: ${MARKET_CONFIG.maxBetSize}`;
        setError(errorMsg);
        throw new Error(errorMsg);
      }

      setIsPlacing(true);
      setError(null);

      try {
        // Convert UI coordinates to contract parameters
        const priceBucket = rowIndex; // Direct mapping: row index = price bucket
        
        // Convert column index to expiry timestamp
        // columnIndex 0 = first bettable column after locked ones
        const expiryTimestampSecs = tapMarketClient.columnIndexToTimestamp(
          columnIndex,
          MARKET_CONFIG.timeBucketSeconds,
          MARKET_CONFIG.lockedColumnsAhead
        );

        console.log("Placing bet with params:", {
          priceBucket,
          expiryTimestampSecs,
          stakeAmount,
          rowIndex,
          columnIndex,
        });

        // Check balance before attempting transaction
        const hasSufficientBalance = await tapMarketClient.checkSufficientBalance(
          account.accountAddress.toString(),
          stakeAmount
        );

        if (!hasSufficientBalance) {
          throw new Error("Insufficient balance to place this bet");
        }

        // Place the bet on-chain
        const txHash = await tapMarketClient.placeBet(account, {
          priceBucket,
          expiryTimestampSecs,
          stakeAmount,
        });

        console.log("Bet placed successfully. Transaction hash:", txHash);
        return txHash;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to place bet";
        console.error("Error placing bet:", errorMessage);
        setError(errorMessage);
        throw err;
      } finally {
        setIsPlacing(false);
      }
    },
    [account]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    placeBet,
    isPlacing,
    error,
    clearError,
  };
}

/**
 * Hook to get current grid state information
 * 
 * This provides derived state about which columns are locked, current, etc.
 */
export function useGridState() {
  const [currentBucket, setCurrentBucket] = useState(() =>
    tapMarketClient.getCurrentTimeBucket(MARKET_CONFIG.timeBucketSeconds)
  );

  // Update current bucket periodically
  useState(() => {
    const interval = setInterval(() => {
      const newBucket = tapMarketClient.getCurrentTimeBucket(MARKET_CONFIG.timeBucketSeconds);
      if (newBucket !== currentBucket) {
        setCurrentBucket(newBucket);
      }
    }, 1000); // Check every second

    return () => clearInterval(interval);
  });

  const earliestBettableBucket = tapMarketClient.getEarliestBettableBucket(
    MARKET_CONFIG.timeBucketSeconds,
    MARKET_CONFIG.lockedColumnsAhead
  );

  return {
    currentBucket,
    earliestBettableBucket,
    lockedColumnsAhead: MARKET_CONFIG.lockedColumnsAhead,
  };
}

/**
 * Calculate the multiplier for a given cell (client-side approximation)
 * 
 * This mirrors the on-chain logic for computing multipliers.
 * Used for UI display only - actual multiplier is computed on-chain.
 * 
 * Formula:
 * - Base: 1.05x (10500 bps)
 * - +0.06x per row from center (600 bps)
 * - +0.08x per column beyond minimum time distance (800 bps)
 * - Capped at 10x (100000 bps)
 */
export function calculateMultiplier(rowIndex: number, columnIndex: number): number {
  const BASE_MULT_BPS = 10500; // 1.05x
  const DISTANCE_STEP_BPS = 600; // +0.06x per row
  const TIME_STEP_BPS = 800; // +0.08x per column beyond min
  const MAX_MULT_BPS = 100000; // 10x cap

  // Price distance from mid bucket
  const midBucket = MARKET_CONFIG.midPriceBucket;
  const priceDistance = Math.abs(rowIndex - midBucket);

  // Time bonus only for columns beyond the minimum required
  // Minimum time distance = lockedColumnsAhead + 1
  const minTimeDistance = MARKET_CONFIG.lockedColumnsAhead + 1;
  
  // Since columnIndex 0 = earliest bettable column,
  // the actual time distance is minTimeDistance + columnIndex
  const actualTimeDistance = minTimeDistance + columnIndex;
  const timeBonusDistance = actualTimeDistance - minTimeDistance; // = columnIndex

  const timeBonusBps = timeBonusDistance * TIME_STEP_BPS;

  // Combine components
  let multBps = BASE_MULT_BPS + priceDistance * DISTANCE_STEP_BPS + timeBonusBps;

  // Clamp to [10000, MAX_MULT_BPS]
  if (multBps < 10000) multBps = 10000;
  if (multBps > MAX_MULT_BPS) multBps = MAX_MULT_BPS;

  // Convert basis points to decimal (10000 bps = 1.00x)
  return multBps / 10000;
}
