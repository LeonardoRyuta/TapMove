/**
 * React hook for interacting with the TapMarket contract
 * 
 * This hook provides a simple interface for placing bets and handles:
 * - Converting UI coordinates (row/column) to contract parameters
 * - Loading states and error handling
 * - Integration with wallet provider
 */

import { useState, useCallback, useEffect } from "react";
import { Account } from "@aptos-labs/ts-sdk";
import {
  NUM_PRICE_BUCKETS,
  LOCKED_COLUMNS_AHEAD,
  MID_PRICE_BUCKET,
  MIN_BET_SIZE,
  MAX_BET_SIZE,
  computeExpiryTimestampSecs,
  getCurrentBucket,
  getFirstBettableBucket,
  COIN_TYPE,
} from "../config/tapMarket";
import { aptosClient, buildPlaceBetPayload, buildSettleBetPayload, buildSettleBetNoPythPayload, extractBetIdFromTransaction } from "../lib/aptosClient";
import type { TransactionPayload } from "../lib/aptosClient";
import { computeMultiplierBps, getExpiryBucket } from "../lib/multipliers";
import { fetchPythPriceUpdateData } from "../lib/pythHermesClient";
import { mapPriceToBucket } from "../config/tapMarket";

export interface AptosSigner {
  signAndSubmitTransaction: (payload: TransactionPayload) => Promise<{ hash: string }>;  
}

export interface PlaceBetParams {
  rowIndex: number; // Price bucket index (0 to numPriceBuckets - 1)
  columnIndex: number; // Time column index (0 = first bettable column)
  stakeAmount: string; // Amount in coin units (as string for precision)
}

export interface PlaceBetResult {
  txHash: string;
  betId: string | null; // Extracted bet ID from transaction
}

export interface SettleBetParams {
  betId: string | number; // Bet ID from on-chain
  priceId: string; // Pyth price feed ID
}

export interface SettleBetNoPythParams {
  betId: string | number; // Bet ID from on-chain
  currentPrice: number; // Current price for bucket calculation
  referencePrice?: number; // Optional reference price for grid alignment
}

export interface UseTapMarketReturn {
  placeBet: (params: PlaceBetParams) => Promise<PlaceBetResult>;
  settleBet: (params: SettleBetParams) => Promise<string>;
  settleBetNoPyth: (params: SettleBetNoPythParams) => Promise<string>;
  isPlacing: boolean;
  isSettling: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Hook for placing bets on the tap market
 * 
 * @param addressOrAccount - Wallet address string or Aptos account
 * @param signer - Optional custom signer (e.g., from Privy wallet)
 * @returns Functions and state for placing bets
 */
export function useTapMarket(addressOrAccount: string | Account | null, signer?: AptosSigner | null): UseTapMarketReturn {
  const [isPlacing, setIsPlacing] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract address string from Account or use directly
  const address = typeof addressOrAccount === 'string' ? addressOrAccount : addressOrAccount?.accountAddress?.toString() || null;

  /**
   * Place a bet by clicking on a grid cell
   * 
   * This converts the UI coordinates to contract parameters:
   * - rowIndex -> price_bucket (direct mapping)
   * - columnIndex -> expiry_timestamp_secs (calculated based on time buckets)
   */
  const placeBet = useCallback(
    async ({ rowIndex, columnIndex, stakeAmount }: PlaceBetParams): Promise<PlaceBetResult> => {
      // Validate address
      if (!address) {
        const errorMsg = "Wallet not connected";
        setError(errorMsg);
        throw new Error(errorMsg);
      }

      // Validate inputs
      if (rowIndex < 0 || rowIndex >= NUM_PRICE_BUCKETS) {
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
      if (stakeAmountNum < MIN_BET_SIZE) {
        const errorMsg = `Stake amount too small. Minimum: ${MIN_BET_SIZE}`;
        setError(errorMsg);
        throw new Error(errorMsg);
      }

      if (stakeAmountNum > MAX_BET_SIZE) {
        const errorMsg = `Stake amount too large. Maximum: ${MAX_BET_SIZE}`;
        setError(errorMsg);
        throw new Error(errorMsg);
      }

      setIsPlacing(true);
      setError(null);

      try {
        // Convert UI coordinates to contract parameters
        const priceBucket = rowIndex; // Direct mapping: row index = price bucket
        
        // Convert column index to expiry timestamp using new config function
        const expiryTimestampSecs = computeExpiryTimestampSecs(columnIndex);

        // Build the correct payload with all 4 arguments
        // Args: market_admin, stake_amount, price_bucket, expiry_timestamp_secs
        const payload = buildPlaceBetPayload(
          priceBucket,
          expiryTimestampSecs,
          stakeAmountNum
        );

        console.log("Placing bet with params:", {
          senderAddress: address,
          priceBucket,
          expiryTimestampSecs,
          stakeAmount,
          stakeAmountNum: stakeAmountNum.toString(),
          rowIndex,
          columnIndex,
          payload,
        });

        // Check balance before attempting transaction
        const balance = await aptosClient.getAccountCoinAmount({
          accountAddress: address,
          coinType: COIN_TYPE,
        });

        if (balance < stakeAmountNum) {
          throw new Error("Insufficient balance to place this bet");
        }

        // Sign and submit using custom signer if provided
        let committedTxn;
        if (signer) {
          // Use Privy's custom signer
          console.log("Using Privy signer with address:", address);
          committedTxn = await signer.signAndSubmitTransaction(payload);
        } else {
          // Use standard Aptos client signing
          console.log("Using standard Aptos signing");
          const transaction = await aptosClient.transaction.build.simple({
            sender: address,
            data: {
              function: payload.function as `${string}::${string}::${string}`,
              typeArguments: payload.typeArguments,
              functionArguments: payload.functionArguments,
            },
          });
          
          committedTxn = await aptosClient.signAndSubmitTransaction({
            signer: addressOrAccount as Account,
            transaction,
          });
        }

        // Wait for transaction
        await aptosClient.waitForTransaction({
          transactionHash: committedTxn.hash,
        });

        console.log("Bet placed successfully. Transaction hash:", committedTxn.hash);
        
        // Extract bet ID from transaction
        const betId = await extractBetIdFromTransaction(committedTxn.hash);
        
        if (betId) {
          console.log("✅ Bet ID automatically extracted:", betId);
        } else {
          console.warn("⚠️ Could not extract bet ID - user will need to enter manually");
        }
        
        setError(null);
        return {
          txHash: committedTxn.hash,
          betId,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to place bet";
        console.error("Error placing bet:", {
          error: errorMessage,
          fullError: err,
          senderAddress: address,
          stakeAmount,
          priceBucket: rowIndex,
          expiryTimestampSecs: computeExpiryTimestampSecs(columnIndex),
        });
        setError(errorMessage);
        throw err;
      } finally {
        setIsPlacing(false);
      }
    },
    [address, signer, addressOrAccount]
  );

  /**
   * Settle a bet using Pyth price data
   * 
   * This calls the settle_bet_public entry function, which is permissionless.
   * Anyone can settle any bet after it expires.
   */
  const settleBet = useCallback(
    async ({ betId, priceId }: SettleBetParams): Promise<string> => {
      // Validate address
      if (!address) {
        const errorMsg = "Wallet not connected";
        setError(errorMsg);
        throw new Error(errorMsg);
      }

      setIsSettling(true);
      setError(null);

      try {
        console.log("🔍 Verifying bet ID exists on-chain...");
        
        // Import the verification function
        const { verifyBetIdExists } = await import('../lib/aptosClient');
        
        // Verify bet ID exists before attempting settlement
        const betExists = await verifyBetIdExists(betId);
        
        if (!betExists) {
          const errorMsg = `Bet ID ${betId} not found on-chain. The bet may have already been settled or the ID was extracted incorrectly.`;
          console.error("❌", errorMsg);
          setError(errorMsg);
          throw new Error(errorMsg);
        }
        
        console.log("✅ Bet ID verified. Fetching Pyth price update for settlement...");
        
        // Fetch latest price update from Pyth Hermes
        const pythPriceUpdate = await fetchPythPriceUpdateData(priceId);
        
        console.log("Building settlement transaction...");
        console.log("arguments:", { 
          betId, 
          priceId, 
          pythPriceUpdate: JSON.stringify(pythPriceUpdate, null, 2) 
        });

        console.log("pythPriceUpdate raw:", pythPriceUpdate[0]);

        // Build the settlement payload
        const payload = buildSettleBetPayload(betId, pythPriceUpdate);

        console.log("Settling bet with params:", {
          senderAddress: address,
          betId,
          priceId,
          payload,
        });

        // Sign and submit using custom signer if provided
        let committedTxn;
        if (signer) {
          // Use Privy's custom signer
          console.log("Using Privy signer for settlement");
          committedTxn = await signer.signAndSubmitTransaction(payload);
          console.log("Settlement transaction submitted with Privy signer:", committedTxn.hash);
        } else {
          // Use standard Aptos client signing
          console.log("Using standard Aptos signing for settlement");
          const transaction = await aptosClient.transaction.build.simple({
            sender: address,
            data: {
              function: payload.function as `${string}::${string}::${string}`,
              typeArguments: payload.typeArguments,
              functionArguments: payload.functionArguments,
            },
          });
          
          committedTxn = await aptosClient.signAndSubmitTransaction({
            signer: addressOrAccount as Account,
            transaction,
          });
        }

        // Wait for transaction
        await aptosClient.waitForTransaction({
          transactionHash: committedTxn.hash,
        });

        console.log("Bet settled successfully. Transaction hash:", committedTxn.hash);
        setError(null);
        return committedTxn.hash;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to settle bet";
        console.error("Error settling bet:", {
          error: errorMessage,
          fullError: err,
          senderAddress: address,
          betId,
        });
        setError(errorMessage);
        throw err;
      } finally {
        setIsSettling(false);
      }
    },
    [address, signer, addressOrAccount]
  );

  /**
   * Settle a bet without requiring Pyth price update (MVP version)
   * 
   * This calls settle_bet_public_no_pyth which accepts the realized bucket
   * as a parameter instead of fetching from Pyth on-chain.
   * 
   * The realized bucket is calculated on the frontend using the same logic
   * as the price grid display.
   */
  const settleBetNoPyth = useCallback(
    async ({ betId, currentPrice, referencePrice }: SettleBetNoPythParams): Promise<string> => {
      // Validate address
      if (!address) {
        const errorMsg = "Wallet not connected";
        setError(errorMsg);
        throw new Error(errorMsg);
      }

      setIsSettling(true);
      setError(null);

      try {
        console.log("🔍 Verifying bet ID exists on-chain...");
        
        // Import the verification function
        const { verifyBetIdExists } = await import('../lib/aptosClient');
        
        // Verify bet ID exists before attempting settlement
        const betExists = await verifyBetIdExists(betId);
        
        if (!betExists) {
          const errorMsg = `Bet ID ${betId} not found on-chain. The bet may have already been settled or the ID was extracted incorrectly.`;
          console.error("❌", errorMsg);
          setError(errorMsg);
          throw new Error(errorMsg);
        }
        
        console.log("✅ Bet ID verified.");
        
        // Calculate the realized bucket using frontend logic
        // Use the same mapping as the grid display
        const refPrice = referencePrice ?? Math.round(currentPrice);
        const realizedBucket = mapPriceToBucket(currentPrice, currentPrice, refPrice);
        
        console.log("📊 Settlement details:", {
          betId,
          currentPrice,
          referencePrice: refPrice,
          realizedBucket,
        });

        // Build the settlement payload (no Pyth update needed)
        const payload = buildSettleBetNoPythPayload(betId, realizedBucket);

        console.log("Settling bet with params:", {
          senderAddress: address,
          betId,
          realizedBucket,
          payload,
        });

        // Sign and submit using custom signer if provided
        let committedTxn;
        if (signer) {
          // Use Privy's custom signer
          console.log("Using Privy signer for settlement");
          committedTxn = await signer.signAndSubmitTransaction(payload);
          console.log("Settlement transaction submitted with Privy signer:", committedTxn.hash);
        } else {
          // Use standard Aptos client signing
          console.log("Using standard Aptos signing for settlement");
          const transaction = await aptosClient.transaction.build.simple({
            sender: address,
            data: {
              function: payload.function as `${string}::${string}::${string}`,
              typeArguments: payload.typeArguments,
              functionArguments: payload.functionArguments,
            },
          });
          
          committedTxn = await aptosClient.signAndSubmitTransaction({
            signer: addressOrAccount as Account,
            transaction,
          });
        }

        // Wait for transaction
        await aptosClient.waitForTransaction({
          transactionHash: committedTxn.hash,
        });

        console.log("✅ Bet settled successfully (no-pyth). Transaction hash:", committedTxn.hash);
        setError(null);
        return committedTxn.hash;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to settle bet";
        console.error("Error settling bet (no-pyth):", {
          error: errorMessage,
          fullError: err,
          senderAddress: address,
          betId,
          currentPrice,
        });
        setError(errorMessage);
        throw err;
      } finally {
        setIsSettling(false);
      }
    },
    [address, signer, addressOrAccount]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    placeBet,
    settleBet, // Keep old version for reference
    settleBetNoPyth, // New MVP version
    isPlacing,
    isSettling,
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
  const [currentBucket, setCurrentBucket] = useState(() => getCurrentBucket());

  // Update current bucket periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const newBucket = getCurrentBucket();
      setCurrentBucket(prevBucket => {
        if (newBucket !== prevBucket) {
          return newBucket;
        }
        return prevBucket;
      });
    }, 1000); // Check every second

    return () => clearInterval(interval);
  }, []);

  const earliestBettableBucket = getFirstBettableBucket();

  return {
    currentBucket,
    earliestBettableBucket,
    lockedColumnsAhead: LOCKED_COLUMNS_AHEAD,
  };
}

/**
 * Calculate the multiplier for a given cell
 * 
 * This mirrors the on-chain compute_multiplier_bps logic exactly.
 * Used for UI display - the actual multiplier is recomputed on-chain.
 * 
 * @param rowIndex - Price bucket (row) index
 * @param columnIndex - Column index (0 = first bettable column)
 * @returns Multiplier as decimal (e.g., 1.73 for 1.73x)
 */
export function calculateMultiplier(rowIndex: number, columnIndex: number): number {
  const currentBucket = getCurrentBucket();
  const expiryBucket = getExpiryBucket(currentBucket, LOCKED_COLUMNS_AHEAD, columnIndex);
  
  const multBps = computeMultiplierBps({
    numPriceBuckets: NUM_PRICE_BUCKETS,
    midPriceBucket: MID_PRICE_BUCKET,
    lockedColumnsAhead: LOCKED_COLUMNS_AHEAD,
    priceBucket: rowIndex,
    expiryBucket,
    currentBucket,
  });

  // Convert basis points to decimal (10_000 bps = 1.00x)
  return multBps / 10_000;
}
