/**
 * Aptos client wrapper for Movement testnet
 */

import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import {
  MOVEMENT_NODE_URL,
  MODULE_ADDRESS,
  MODULE_NAME,
  COIN_TYPE,
  MARKET_ADMIN_ADDRESS,
} from "../config/tapMarket";

// Initialize Aptos client for Movement testnet
const config = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: MOVEMENT_NODE_URL,
});

export const aptosClient = new Aptos(config);

/**
 * Build the payload for place_bet transaction
 * 
 * @param priceBucket - Row index (0 to NUM_PRICE_BUCKETS-1)
 * @param expiryTimestampSecs - Unix timestamp when bet settles
 * @param stakeAmount - Amount to stake in coin units
 */
export function buildPlaceBetPayload(
  priceBucket: number,
  expiryTimestampSecs: number,
  stakeAmount: bigint,
) {
  return {
    function: `${MODULE_ADDRESS}::${MODULE_NAME}::place_bet`,
    typeArguments: [COIN_TYPE],
    functionArguments: [
      MARKET_ADMIN_ADDRESS,      // market_admin: address
      stakeAmount.toString(),    // stake_amount: u64
      priceBucket,               // price_bucket: u8
      expiryTimestampSecs,       // expiry_timestamp_secs: u64
    ],
  };
}

/**
 * Submit a transaction using the provided signer
 * 
 * @param signer - Wallet signer with signAndSubmitTransaction method
 * @param payload - Transaction payload
 * @returns Transaction hash
 */
export async function submitTransactionWithSigner(
  signer: {
    signAndSubmitTransaction: (payload: any) => Promise<{ hash: string }>;
  },
  payload: any,
): Promise<string> {
  console.log("Submitting transaction:", payload);
  
  try {
    // Sign and submit the transaction
    const tx = await signer.signAndSubmitTransaction(payload);
    
    console.log("Transaction submitted:", tx.hash);
    
    // Wait for confirmation
    await aptosClient.waitForTransaction({
      transactionHash: tx.hash,
    });
    
    console.log("Transaction confirmed:", tx.hash);
    
    return tx.hash;
  } catch (error) {
    console.error("Transaction failed:", error);
    throw parseTransactionError(error);
  }
}

/**
 * Parse transaction errors into user-friendly messages
 */
function parseTransactionError(error: any): Error {
  const errorStr = error?.toString() || "";
  
  // Map contract error codes to messages
  if (errorStr.includes("E_INVALID_PRICE_BUCKET") || errorStr.includes("3")) {
    return new Error("Invalid price bucket selected");
  }
  if (errorStr.includes("E_BET_TOO_SMALL") || errorStr.includes("4")) {
    return new Error("Bet amount is too small");
  }
  if (errorStr.includes("E_BET_TOO_LARGE") || errorStr.includes("5")) {
    return new Error("Bet amount is too large");
  }
  if (errorStr.includes("E_EXPIRY_TOO_SOON") || errorStr.includes("6")) {
    return new Error("Cannot bet on this time bucket - too soon");
  }
  if (errorStr.includes("E_EXPIRY_TOO_FAR") || errorStr.includes("7")) {
    return new Error("Cannot bet that far into the future");
  }
  if (errorStr.includes("E_COLUMN_LOCKED") || errorStr.includes("8")) {
    return new Error("This time column is locked - choose a future column");
  }
  if (errorStr.includes("E_TOO_MANY_OPEN_BETS") || errorStr.includes("11")) {
    return new Error("You have too many open bets. Wait for some to settle.");
  }
  if (errorStr.includes("E_HOUSE_INSUFFICIENT_LIQUIDITY") || errorStr.includes("13")) {
    return new Error("House has insufficient liquidity for this bet");
  }
  if (errorStr.includes("INSUFFICIENT_BALANCE")) {
    return new Error("Insufficient balance to place this bet");
  }
  if (errorStr.includes("E_NO_MARKET") || errorStr.includes("12")) {
    return new Error("Market not initialized");
  }
  
  return new Error(`Transaction failed: ${errorStr}`);
}

/**
 * Check if user has sufficient balance
 * 
 * @param userAddress - User's address
 * @param stakeAmount - Amount to stake
 */
export async function checkSufficientBalance(
  userAddress: string,
  stakeAmount: bigint,
): Promise<boolean> {
  try {
    const balance = await aptosClient.getAccountCoinAmount({
      accountAddress: userAddress,
      coinType: COIN_TYPE,
    });
    
    return BigInt(balance) >= stakeAmount;
  } catch (error) {
    console.error("Failed to check balance:", error);
    return false;
  }
}
