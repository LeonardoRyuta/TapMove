/**
 * TypeScript client for interacting with the tap_market Move contract on Movement
 * 
 * This module provides type-safe functions to call the contract's entry functions.
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import {
  MOVEMENT_TESTNET_RPC,
  MODULE_ADDRESS,
  MODULE_NAME,
  COIN_TYPE,
  MARKET_ADMIN_ADDRESS,
} from "./config";

// Initialize Aptos client
const aptosConfig = new AptosConfig({ 
  network: Network.CUSTOM,
  fullnode: MOVEMENT_TESTNET_RPC,
});

export const aptos = new Aptos(aptosConfig);

/**
 * Arguments for initializing a new market (admin only)
 */
export interface InitMarketArgs {
  numPriceBuckets: number;
  midPriceBucket: number;
  timeBucketSeconds: number;
  maxExpiryBucketsAhead: number;
  lockedColumnsAhead: number;
  minBetSize: number;
  maxBetSize: number;
  maxOpenBetsPerUser: number;
  anchorPriceMagnitude: string; // u64 as string
  anchorPriceNegative: boolean;
  bucketSizeMagnitude: string; // u64 as string
  bucketSizeNegative: boolean;
  priceFeedId: Uint8Array; // Pyth price feed ID bytes
  initialHouseLiquidityAmount: string; // u64 as string
}

/**
 * Arguments for placing a bet
 */
export interface PlaceBetArgs {
  priceBucket: number; // u8: which row (price bucket) to bet on
  expiryTimestampSecs: number; // u64: when this bet expires (Unix timestamp)
  stakeAmount: string; // u64 as string: amount to stake in coin units
}

/**
 * Arguments for settling a bet (admin only)
 */
export interface SettleBetArgs {
  betId: string; // u64 as string
  pythPriceUpdate: Uint8Array[]; // vector<vector<u8>>
}

/**
 * Initialize a new market for a specific CoinType
 * 
 * This should only be called by the admin account once.
 * The Market<CoinType> resource will be stored under the admin's address.
 * 
 * @param adminAccount - The admin's account (signer)
 * @param args - Market initialization parameters
 * @returns Transaction hash
 */
export async function initMarket(
  adminAccount: Account,
  args: InitMarketArgs
): Promise<string> {
  try {
    // Build the transaction payload
    const transaction = await aptos.transaction.build.simple({
      sender: adminAccount.accountAddress,
      data: {
        function: `${MODULE_ADDRESS}::${MODULE_NAME}::init_market`,
        typeArguments: [COIN_TYPE], // Generic type parameter: <CoinType>
        functionArguments: [
          args.numPriceBuckets,
          args.midPriceBucket,
          args.timeBucketSeconds,
          args.maxExpiryBucketsAhead,
          args.lockedColumnsAhead,
          args.minBetSize,
          args.maxBetSize,
          args.maxOpenBetsPerUser,
          args.anchorPriceMagnitude,
          args.anchorPriceNegative,
          args.bucketSizeMagnitude,
          args.bucketSizeNegative,
          Array.from(args.priceFeedId), // Convert Uint8Array to number array
          args.initialHouseLiquidityAmount,
        ],
      },
    });

    // Sign and submit the transaction
    const committedTxn = await aptos.signAndSubmitTransaction({
      signer: adminAccount,
      transaction,
    });

    // Wait for the transaction to be confirmed
    const executedTransaction = await aptos.waitForTransaction({
      transactionHash: committedTxn.hash,
    });

    console.log("Market initialized successfully:", executedTransaction.hash);
    return executedTransaction.hash;
  } catch (error) {
    console.error("Failed to initialize market:", error);
    throw new Error(`Failed to initialize market: ${error}`);
  }
}

/**
 * Place a bet on a specific price bucket at a future time
 * 
 * This is the main function users call when they "tap" a cell in the grid.
 * The contract will:
 * - Validate the bet parameters (size, expiry, locked columns)
 * - Compute the multiplier based on risk (price distance + time distance)
 * - Withdraw the stake from the user's account into the house vault
 * - Store the bet for later settlement
 * 
 * @param userAccount - The user's account (signer)
 * @param args - Bet parameters
 * @returns Transaction hash
 */
export async function placeBet(
  userAccount: Account,
  args: PlaceBetArgs
): Promise<string> {
  try {
    console.log("Placing bet:", {
      priceBucket: args.priceBucket,
      expiryTimestampSecs: args.expiryTimestampSecs,
      stakeAmount: args.stakeAmount,
      userAddress: userAccount.accountAddress.toString(),
    });

    // Build the transaction payload
    const transaction = await aptos.transaction.build.simple({
      sender: userAccount.accountAddress,
      data: {
        function: `${MODULE_ADDRESS}::${MODULE_NAME}::place_bet`,
        typeArguments: [COIN_TYPE], // Generic type parameter: <CoinType>
        functionArguments: [
          MARKET_ADMIN_ADDRESS, // market_admin: address where Market<CoinType> is stored
          args.stakeAmount, // stake_amount: u64
          args.priceBucket, // price_bucket: u8
          args.expiryTimestampSecs, // expiry_timestamp_secs: u64
        ],
      },
    });

    // Sign and submit the transaction
    const committedTxn = await aptos.signAndSubmitTransaction({
      signer: userAccount,
      transaction,
    });

    // Wait for the transaction to be confirmed
    const executedTransaction = await aptos.waitForTransaction({
      transactionHash: committedTxn.hash,
    });

    console.log("Bet placed successfully:", executedTransaction.hash);
    return executedTransaction.hash;
  } catch (error) {
    console.error("Failed to place bet:", error);
    
    // Parse common errors to provide better UX feedback
    const errorMessage = parseContractError(error);
    throw new Error(errorMessage);
  }
}

/**
 * Settle a bet using Pyth price data (admin only)
 * 
 * This should be called by the admin after a bet's expiry time has passed.
 * The contract will:
 * - Verify the bet has expired
 * - Update Pyth price feed with provided data
 * - Read the realized price from Pyth
 * - Map it to a price bucket
 * - Determine if the user won or lost
 * - Pay out if they won
 * - Mark the bet as settled
 * 
 * @param adminAccount - The admin's account (signer)
 * @param args - Settlement parameters
 * @returns Transaction hash
 */
export async function settleBet(
  adminAccount: Account,
  args: SettleBetArgs
): Promise<string> {
  try {
    // Convert Uint8Array[] to number[][]
    const pythUpdateArray = args.pythPriceUpdate.map(inner => Array.from(inner));

    // Build the transaction payload
    const transaction = await aptos.transaction.build.simple({
      sender: adminAccount.accountAddress,
      data: {
        function: `${MODULE_ADDRESS}::${MODULE_NAME}::settle_bet`,
        typeArguments: [COIN_TYPE], // Generic type parameter: <CoinType>
        functionArguments: [
          args.betId, // bet_id: u64
          pythUpdateArray, // pyth_price_update: vector<vector<u8>>
        ],
      },
    });

    // Sign and submit the transaction
    const committedTxn = await aptos.signAndSubmitTransaction({
      signer: adminAccount,
      transaction,
    });

    // Wait for the transaction to be confirmed
    const executedTransaction = await aptos.waitForTransaction({
      transactionHash: committedTxn.hash,
    });

    console.log("Bet settled successfully:", executedTransaction.hash);
    return executedTransaction.hash;
  } catch (error) {
    console.error("Failed to settle bet:", error);
    throw new Error(`Failed to settle bet: ${error}`);
  }
}

/**
 * Parse contract errors into user-friendly messages
 */
function parseContractError(error: any): string {
  const errorStr = error?.toString() || "";
  
  // Map Move error codes to user-friendly messages
  // These correspond to the E_* constants in the contract
  if (errorStr.includes("E_INVALID_PRICE_BUCKET") || errorStr.includes("3")) {
    return "Invalid price bucket selected";
  }
  if (errorStr.includes("E_BET_TOO_SMALL") || errorStr.includes("4")) {
    return "Bet amount is too small";
  }
  if (errorStr.includes("E_BET_TOO_LARGE") || errorStr.includes("5")) {
    return "Bet amount is too large";
  }
  if (errorStr.includes("E_EXPIRY_TOO_SOON") || errorStr.includes("6")) {
    return "Cannot bet on this time bucket - too soon";
  }
  if (errorStr.includes("E_EXPIRY_TOO_FAR") || errorStr.includes("7")) {
    return "Cannot bet that far into the future";
  }
  if (errorStr.includes("E_COLUMN_LOCKED") || errorStr.includes("8")) {
    return "This time column is locked - choose a future column";
  }
  if (errorStr.includes("E_TOO_MANY_OPEN_BETS") || errorStr.includes("11")) {
    return "You have too many open bets. Wait for some to settle.";
  }
  if (errorStr.includes("E_HOUSE_INSUFFICIENT_LIQUIDITY") || errorStr.includes("13")) {
    return "House has insufficient liquidity for this bet";
  }
  if (errorStr.includes("INSUFFICIENT_BALANCE")) {
    return "Insufficient balance to place this bet";
  }
  
  return `Failed to place bet: ${errorStr}`;
}

/**
 * Get the current time bucket based on on-chain time
 * 
 * This is a pure function that matches the contract's logic:
 * current_time_bucket = timestamp::now_seconds() / time_bucket_seconds
 * 
 * @param timeBucketSeconds - Size of each time bucket in seconds
 * @returns Current time bucket index
 */
export function getCurrentTimeBucket(timeBucketSeconds: number): number {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.floor(nowSeconds / timeBucketSeconds);
}

/**
 * Calculate the earliest allowed expiry bucket
 * 
 * Per contract logic:
 * earliest_allowed_bucket = current_bucket + locked_columns_ahead + 1
 * 
 * @param timeBucketSeconds - Size of each time bucket in seconds
 * @param lockedColumnsAhead - Number of locked columns after current
 * @returns Earliest bucket index where bets are allowed
 */
export function getEarliestBettableBucket(
  timeBucketSeconds: number,
  lockedColumnsAhead: number
): number {
  const currentBucket = getCurrentTimeBucket(timeBucketSeconds);
  return currentBucket + lockedColumnsAhead + 1;
}

/**
 * Convert a column index (relative to UI) to an absolute expiry timestamp
 * 
 * @param columnIndex - Column index in the UI (0 = earliest bettable column)
 * @param timeBucketSeconds - Size of each time bucket in seconds
 * @param lockedColumnsAhead - Number of locked columns after current
 * @returns Unix timestamp in seconds
 */
export function columnIndexToTimestamp(
  columnIndex: number,
  timeBucketSeconds: number,
  lockedColumnsAhead: number
): number {
  const earliestBucket = getEarliestBettableBucket(timeBucketSeconds, lockedColumnsAhead);
  const targetBucket = earliestBucket + columnIndex;
  // Return a timestamp within the target bucket (we use the bucket start time)
  return targetBucket * timeBucketSeconds;
}

/**
 * Check if the user has sufficient balance to place a bet
 * 
 * @param userAddress - User's address
 * @param stakeAmount - Amount to stake
 * @returns true if user has sufficient balance
 */
export async function checkSufficientBalance(
  userAddress: string,
  stakeAmount: string
): Promise<boolean> {
  try {
    // Get the user's coin balance
    // Note: This assumes the coin type is registered with the user's account
    const balance = await aptos.getAccountCoinAmount({
      accountAddress: userAddress,
      coinType: COIN_TYPE,
    });
    
    return BigInt(balance) >= BigInt(stakeAmount);
  } catch (error) {
    console.error("Failed to check balance:", error);
    return false;
  }
}
