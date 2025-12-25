/**
 * React hook for interacting with the TapMarket contract
 * 
 * This hook provides a simple interface for placing bets and handles:
 * - Converting UI coordinates (row/column) to contract parameters
 * - Loading states and error handling
 * - Integration with wallet provider
 */

import { useState, useCallback, useEffect, useRef } from "react";
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
  MARKET_ADMIN_ADDRESS,
  MODULE_ADDRESS,
  MODULE_NAME,
} from "../config/tapMarket";
import { aptosClient, buildPlaceBetPayload, buildSettleBetPayload, buildSettleBetNoPythPayload, extractBetIdFromTransaction, extractBetSettlementFromTransaction, type BetSettlementResult } from "../lib/aptosClient";
import type { TransactionPayload } from "../lib/aptosClient";
import { computeMultiplierBps, getExpiryBucket } from "../lib/multipliers";
import { fetchPythPriceUpdateData } from "../lib/pythHermesClient";
import { mapPriceToBucket } from "../config/tapMarket";
import { sponsorTransaction } from "../lib/sponsorClient";

export interface AptosSigner {
  signAndSubmitTransaction: (payload: TransactionPayload) => Promise<{ hash: string }>;  
  signTransaction?: (payload: TransactionPayload, withFeePayer?: boolean) => Promise<Uint8Array>;
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
  settleBetNoPyth: (params: SettleBetNoPythParams) => Promise<BetSettlementResult | null>;
  isPlacing: boolean;
  isSettling: boolean;
  error: string | null;
  clearError: () => void;
  queueLength: number;
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
  
  // Bet queue system for handling multiple rapid bets
  const betQueueRef = useRef<Array<() => Promise<PlaceBetResult>>>([]);
  const isProcessingQueueRef = useRef(false);
  const pendingBetsCountRef = useRef(0);

  // Track the last transaction timestamp to prevent rapid-fire sequence number conflicts
  const lastTxTimestampRef = useRef<number>(0);

  /**
   * Process the bet queue sequentially
   * Each bet waits for the previous one to complete before starting
   */
  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    if (betQueueRef.current.length === 0) return;
    
    isProcessingQueueRef.current = true;
    
    while (betQueueRef.current.length > 0) {
      const betFn = betQueueRef.current.shift();
      if (!betFn) continue;
      
      try {
        await betFn();
        // Small delay between bets to prevent sequence number conflicts
        // Reduced from 500ms to 200ms since we now return immediately after submission
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error('Bet in queue failed:', error);
        // Continue processing remaining bets even if one fails
      }
    }
    
    isProcessingQueueRef.current = false;
  }, []);

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

      // Queue this bet for sequential processing
      return new Promise<PlaceBetResult>((resolve, reject) => {
        const betFn = async () => {
          try {
            setIsPlacing(true);
            pendingBetsCountRef.current++;
            
            const result = await executePlaceBet({ rowIndex, columnIndex, stakeAmount });
            resolve(result);
            return result;
          } catch (error) {
            reject(error);
            throw error;
          } finally {
            pendingBetsCountRef.current--;
            if (pendingBetsCountRef.current === 0) {
              setIsPlacing(false);
            }
          }
        };
        
        betQueueRef.current.push(betFn);
        processQueue();
      });
    },
    [address, processQueue]
  );
  
  /**
   * Execute a single bet placement (internal function)
   */
  const executePlaceBet = useCallback(
    async ({ rowIndex, columnIndex, stakeAmount }: PlaceBetParams): Promise<PlaceBetResult> => {
      if (!address) {
        throw new Error("Wallet not connected");
      }

      const stakeAmountNum = BigInt(stakeAmount);
      
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

      // Check balance before attempting transaction (only for stake amount, not gas)
      const balance = await aptosClient.getAccountCoinAmount({
        accountAddress: address,
        coinType: COIN_TYPE,
      });

      if (balance < stakeAmountNum) {
        throw new Error("Insufficient balance to place this bet");
      }

      try {
        // NOTE: We build the transaction on the frontend to get the latest sequence number
        console.log("🎉 Building sponsored transaction (gasless)...");
        const transaction = await aptosClient.transaction.build.simple({
          sender: address,
          data: {
            function: `${MODULE_ADDRESS}::${MODULE_NAME}::place_bet` as `${string}::${string}::${string}`,
            typeArguments: [COIN_TYPE],
            functionArguments: [
              MARKET_ADMIN_ADDRESS,
              stakeAmountNum.toString(),
              priceBucket,
              expiryTimestampSecs,
            ],
          },
          withFeePayer: true, // Enable sponsored transaction
        });

        // Sign the transaction
        console.log("✍️ Signing transaction with user wallet...");
        let senderAuthenticator;
        
        if (signer && signer.signTransaction) {
          // Use custom signer's signTransaction method (e.g., Privy)
          // Pass the built transaction object, not the payload
          const signatureBytes = await signer.signTransaction(transaction);
          const { AccountAuthenticator, Deserializer } = await import("@aptos-labs/ts-sdk");
          const deserializer = new Deserializer(new Uint8Array(signatureBytes));
          senderAuthenticator = AccountAuthenticator.deserialize(deserializer);
        } else if (addressOrAccount && typeof addressOrAccount !== 'string') {
          // Use standard Account object signing
          senderAuthenticator = aptosClient.transaction.sign({
            signer: addressOrAccount as Account,
            transaction,
          });
        } else {
          throw new Error("No valid signer available. Please ensure wallet is properly connected.");
        }

        // Send to backend for sponsoring and submission
        console.log("🚀 Sending to sponsorship server...");
        const result = await sponsorTransaction(transaction, senderAuthenticator);

        if (!result.success) {
          throw new Error(result.error || "Failed to sponsor transaction");
        }

        console.log("✅ Transaction sponsored and submitted!");
        const committedTxn = { hash: result.txHash! };

        // Update last transaction timestamp for throttling
        lastTxTimestampRef.current = Date.now();

        console.log("Bet placed successfully. Transaction hash:", committedTxn.hash);
        
        // Extract bet ID in background (don't block on this)
        extractBetIdFromTransaction(committedTxn.hash).then(betId => {
          if (betId) {
            console.log("✅ Bet ID automatically extracted:", betId);
            // TODO: Update the bet in state with the extracted betId
          } else {
            console.warn("⚠️ Could not extract bet ID - user will need to enter manually");
          }
        }).catch(err => {
          console.error("Error extracting bet ID:", err);
        });
        
        setError(null);
        // Return immediately without waiting for bet ID extraction
        return {
          txHash: committedTxn.hash,
          betId: null, // Will be extracted in background
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to place bet";
        
        // Check if it's a stale sequence number error and suggest retry
        if (errorMessage.includes("Stale sequenceNumber") || errorMessage.includes("SEQUENCE_NUMBER")) {
          const retryMessage = "Transaction sequence number conflict. Please wait a moment and try again.";
          console.error("⚠️ Sequence number error - transaction may have been sent too quickly:", {
            error: errorMessage,
            fullError: err,
            suggestion: "Wait 1-2 seconds before placing another bet",
          });
          setError(retryMessage);
          throw new Error(retryMessage);
        }
        
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

        // Build transaction with sponsored gas (withFeePayer: true)
        console.log("🎉 Building sponsored settlement transaction (gasless)...");
        const transaction = await aptosClient.transaction.build.simple({
          sender: address,
          data: {
            function: payload.function as `${string}::${string}::${string}`,
            typeArguments: payload.typeArguments,
            functionArguments: payload.functionArguments,
          },
          withFeePayer: true, // Enable sponsored transaction
        });

        // Sign the transaction
        console.log("✍️ Signing settlement transaction...");
        let senderAuthenticator;
        
        if (signer && signer.signTransaction) {
          // Use custom signer's signTransaction method (e.g., Privy)
          // Pass the built transaction object, not the payload
          const signatureBytes = await signer.signTransaction(transaction);
          const { AccountAuthenticator, Deserializer } = await import("@aptos-labs/ts-sdk");
          const deserializer = new Deserializer(new Uint8Array(signatureBytes));
          senderAuthenticator = AccountAuthenticator.deserialize(deserializer);
        } else if (addressOrAccount && typeof addressOrAccount !== 'string') {
          // Use standard Account object signing
          senderAuthenticator = aptosClient.transaction.sign({
            signer: addressOrAccount as Account,
            transaction,
          });
        } else {
          throw new Error("No valid signer available. Please ensure wallet is properly connected.");
        }

        // Send to backend for sponsoring and submission
        console.log("🚀 Sending settlement to sponsorship server...");
        const result = await sponsorTransaction(transaction, senderAuthenticator);

        if (!result.success) {
          throw new Error(result.error || "Failed to sponsor settlement transaction");
        }

        console.log("✅ Settlement transaction sponsored and submitted!");
        const committedTxn = { hash: result.txHash! };

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
    async ({ betId, currentPrice, referencePrice }: SettleBetNoPythParams): Promise<BetSettlementResult | null> => {
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
        
        // Calculate the realized bucket using the EXACT SAME formula as convertPriceToPriceBucket
        // This MUST match the formula in PriceCanvas to ensure consistency
        const refPrice = referencePrice ?? Math.ceil(currentPrice / 0.5) * 0.5;
        
        // Calculate using EXACT same static grid formula as grid drawing
        const PRICE_PER_GRID = 0.5;
        const GRID_SIZE = 50;
        const worldY = ((refPrice - currentPrice) / PRICE_PER_GRID) * GRID_SIZE;
        const gridRow = Math.floor(worldY / GRID_SIZE); // MUST use Math.floor to match grid drawing
        const realizedBucket = MID_PRICE_BUCKET - gridRow;
        
        console.log("📊 Settlement calculation details:", {
          betId,
          currentPrice,
          referencePrice: refPrice,
          worldY: worldY.toFixed(2),
          gridRow,
          realizedBucket,
          formula: `realizedBucket = MID_PRICE_BUCKET(${MID_PRICE_BUCKET}) - gridRow(${gridRow}) = ${realizedBucket}`,
        });

        // Build the settlement payload (no Pyth update needed)
        const payload = buildSettleBetNoPythPayload(betId, realizedBucket);

        console.log("Settling bet with params:", {
          senderAddress: address,
          betId,
          realizedBucket,
          payload,
        });

        // Build transaction with sponsored gas (withFeePayer: true)
        console.log("🎉 Building sponsored settlement transaction (gasless, no-pyth)...");
        const transaction = await aptosClient.transaction.build.simple({
          sender: address,
          data: {
            function: payload.function as `${string}::${string}::${string}`,
            typeArguments: payload.typeArguments,
            functionArguments: payload.functionArguments,
          },
          withFeePayer: true, // Enable sponsored transaction
        });

        // Sign the transaction
        console.log("✍️ Signing settlement transaction...");
        let senderAuthenticator;
        
        if (signer && signer.signTransaction) {
          // Use custom signer's signTransaction method (e.g., Privy)
          // Pass the built transaction object, not the payload
          const signatureBytes = await signer.signTransaction(transaction);
          const { AccountAuthenticator, Deserializer } = await import("@aptos-labs/ts-sdk");
          const deserializer = new Deserializer(new Uint8Array(signatureBytes));
          senderAuthenticator = AccountAuthenticator.deserialize(deserializer);
        } else if (addressOrAccount && typeof addressOrAccount !== 'string') {
          // Use standard Account object signing
          senderAuthenticator = aptosClient.transaction.sign({
            signer: addressOrAccount as Account,
            transaction,
          });
        } else {
          throw new Error("No valid signer available. Please ensure wallet is properly connected.");
        }

        // Send to backend for sponsoring and submission
        console.log("🚀 Sending settlement to sponsorship server...");
        const result = await sponsorTransaction(transaction, senderAuthenticator);

        if (!result.success) {
          throw new Error(result.error || "Failed to sponsor settlement transaction");
        }

        console.log("✅ Settlement transaction sponsored and submitted!");
        const committedTxn = { hash: result.txHash! };

        console.log("✅ Bet settled successfully (no-pyth). Transaction hash:", committedTxn.hash);
        
        // Extract settlement result from transaction events
        const settlementResult = await extractBetSettlementFromTransaction(committedTxn.hash);
        
        if (settlementResult) {
          console.log("📊 Settlement result:", {
            won: settlementResult.won,
            payout: settlementResult.payout,
            priceBucket: settlementResult.priceBucket,
            realizedBucket: settlementResult.realizedBucket,
          });
        }
        
        setError(null);
        return settlementResult;
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
  
  // Expose queue length for UI feedback
  const queueLength = betQueueRef.current.length;

  return {
    placeBet,
    settleBet, // Keep old version for reference
    settleBetNoPyth, // New MVP version
    isPlacing,
    isSettling,
    error,
    clearError,
    queueLength, // Number of bets waiting to be processed
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
