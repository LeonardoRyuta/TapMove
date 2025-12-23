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
 * Build the payload for settle_bet_public_no_pyth transaction (MVP version)
 * 
 * This version doesn't require Pyth price updates - the caller provides
 * the realized bucket directly.
 * 
 * @param betId - Unique bet ID (u64)
 * @param realizedBucket - The price bucket where the price ended up (u8)
 */
export function buildSettleBetNoPythPayload(
  betId: string | number,
  realizedBucket: number,
) {
  return {
    function: `${MODULE_ADDRESS}::${MODULE_NAME}::settle_bet_public_no_pyth`,
    typeArguments: [COIN_TYPE],
    functionArguments: [
      MARKET_ADMIN_ADDRESS,      // market_admin: address
      betId.toString(),          // bet_id: u64
      realizedBucket,            // realized_bucket: u8
    ],
  };
}

/**
 * Build the payload for settle_bet_public transaction (legacy Pyth version)
 * 
 * TODO: This is the old version that requires Pyth price updates on-chain.
 * Kept for reference but not actively used in MVP.
 * 
 * @param betId - Unique bet ID (u64)
 * @param pythPriceUpdate - Nested array of price update bytes (vector<vector<u8>>)
 */
export function buildSettleBetPayload(
  betId: string | number,
  pythPriceUpdate: number[][],
) {
  return {
    function: `${MODULE_ADDRESS}::${MODULE_NAME}::settle_bet_public`,
    typeArguments: [COIN_TYPE],
    functionArguments: [
      MARKET_ADMIN_ADDRESS,      // market_admin: address
      betId.toString(),          // bet_id: u64
      pythPriceUpdate,           // pyth_price_update: vector<vector<u8>>
    ],
  };
}

/**
 * Extract bet ID from a place_bet transaction
 * 
 * How it works:
 * 1. The smart contract stores bets with sequential IDs from `next_bet_id`
 * 2. After placing a bet, the contract increments `next_bet_id`
 * 3. We query the transaction to read the new `next_bet_id` value
 * 4. The bet we just placed has ID = next_bet_id - 1
 * 
 * This eliminates the need for users to manually track or input bet IDs!
 * 
 * @param txHash - Transaction hash from place_bet
 * @returns The bet ID, or null if not found
 */
export async function extractBetIdFromTransaction(
  txHash: string,
): Promise<string | null> {
  try {
    // Wait for transaction to be fully indexed (increased from 1s to 3s)
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('🔍 Querying transaction for bet ID extraction:', txHash);
    
    // Query the transaction with retries
    let txn;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        txn = await aptosClient.getTransactionByHash({ transactionHash: txHash });
        
        // Check if transaction was successful
        if ('success' in txn && !txn.success) {
          console.error('❌ Transaction failed, cannot extract bet ID');
          return null;
        }
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        console.log(`Retry ${attempt + 1}/3 for transaction query...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    if (!txn) {
      console.warn('⚠️ Could not query transaction');
      return null;
    }
    
    if ('changes' in txn && Array.isArray(txn.changes)) {
      // Look for write set changes to the Market resource
      for (const change of txn.changes) {
        if (
          change.type === 'write_resource' &&
          'address' in change &&
          change.address === MARKET_ADMIN_ADDRESS &&
          'data' in change &&
          typeof change.data === 'object' &&
          change.data !== null &&
          'type' in change.data &&
          typeof change.data.type === 'string' &&
          change.data.type.includes('::tap_market::Market')
        ) {
          // Found the Market resource change
          interface MarketResourceData {
            data: {
              next_bet_id: string;
            };
          }
          const data = change.data as unknown as MarketResourceData;
          if (data.data && typeof data.data.next_bet_id === 'string') {
            // next_bet_id was incremented, so the bet we just placed is next_bet_id - 1
            const nextBetId = parseInt(data.data.next_bet_id, 10);
            const betId = nextBetId - 1;
            console.log(`✅ Extracted bet ID from transaction: ${betId} (next_bet_id: ${nextBetId})`);
            
            // Validate bet ID
            if (betId < 0) {
              console.error('❌ Invalid bet ID (negative):', betId);
              return null;
            }
            
            return betId.toString();
          }
        }
      }
      
      console.log('📋 Available changes in transaction:', txn.changes.map((c) => ({
        type: c.type,
        address: 'address' in c ? c.address : undefined,
        dataType: 'data' in c && c.data && typeof c.data === 'object' && 'type' in c.data ? c.data.type : undefined
      })));
    }
    
    console.warn('⚠️ Could not find Market resource in transaction changes');
    return null;
  } catch (error) {
    console.error('Error extracting bet ID from transaction:', error);
    return null;
  }
}

/**
 * Transaction payload structure
 */
export interface TransactionPayload {
  function: string;
  typeArguments: string[];
  functionArguments: (string | number | number[][])[];
}

/**
 * Wallet signer interface
 */
export interface WalletSigner {
  signAndSubmitTransaction: (payload: TransactionPayload) => Promise<{ hash: string }>;
}

/**
 * Submit a transaction using the provided signer
 * 
 * @param signer - Wallet signer with signAndSubmitTransaction method
 * @param payload - Transaction payload
 * @returns Transaction hash
 */
export async function submitTransactionWithSigner(
  signer: WalletSigner,
  payload: TransactionPayload,
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
function parseTransactionError(error: unknown): Error {
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

/**
 * Query the Market resource to get the current next_bet_id
 * This helps verify what bet IDs are valid on-chain
 * 
 * @returns The current next_bet_id value, or null if market not found
 */
export async function getMarketNextBetId(): Promise<string | null> {
  try {
    const marketResourceType = `${MODULE_ADDRESS}::${MODULE_NAME}::Market<${COIN_TYPE}>`;
    
    console.log('🔍 Querying Market resource:', marketResourceType);
    console.log('   Market admin address:', MARKET_ADMIN_ADDRESS);
    
    const resources = await aptosClient.getAccountResources({
      accountAddress: MARKET_ADMIN_ADDRESS,
    });
    
    console.log('📦 Found resources:', resources.length);
    
    // Find the Market resource
    const marketResource = resources.find(r => r.type === marketResourceType);
    
    if (!marketResource) {
      console.error('❌ Market resource not found');
      console.log('Available resources:', resources.map(r => r.type));
      return null;
    }
    
    const marketData = marketResource.data as { next_bet_id?: string };
    const nextBetId = marketData.next_bet_id;
    
    console.log('✅ Market next_bet_id:', nextBetId);
    
    return nextBetId || null;
  } catch (error) {
    console.error('Failed to query Market resource:', error);
    return null;
  }
}

/**
 * Verify if a bet ID exists on-chain by checking if it's less than next_bet_id
 * 
 * @param betId - The bet ID to verify
 * @returns True if bet ID is valid (less than next_bet_id), false otherwise
 */
export async function verifyBetIdExists(betId: string | number): Promise<boolean> {
  try {
    const nextBetId = await getMarketNextBetId();
    
    if (nextBetId === null) {
      console.error('Cannot verify bet ID - Market not found');
      return false;
    }
    
    const betIdNum = BigInt(betId.toString());
    const nextBetIdNum = BigInt(nextBetId);
    
    const exists = betIdNum < nextBetIdNum;
    
    console.log(`🔍 Bet ID ${betId} ${exists ? 'EXISTS' : 'DOES NOT EXIST'} (next_bet_id: ${nextBetId})`);
    
    return exists;
  } catch (error) {
    console.error('Failed to verify bet ID:', error);
    return false;
  }
}

/**
 * Bet settlement result from on-chain event
 */
export interface BetSettlementResult {
  betId: string;
  user: string;
  priceBucket: number;
  realizedBucket: number;
  won: boolean;
  stake: string;
  payout: string;
}

/**
 * Extract bet settlement result from a settle_bet transaction
 * 
 * Reads the BetSettledEvent emitted by the contract to determine:
 * - Whether the bet won or lost
 * - The payout amount (if won)
 * - The realized price bucket vs predicted bucket
 * 
 * @param txHash - Transaction hash from settle_bet
 * @returns Settlement result, or null if not found
 */
export async function extractBetSettlementFromTransaction(
  txHash: string,
): Promise<BetSettlementResult | null> {
  try {
    // Wait for transaction to be fully indexed
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('🔍 Querying transaction for bet settlement result:', txHash);
    
    // Query the transaction with retries
    let txn;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        txn = await aptosClient.getTransactionByHash({
          transactionHash: txHash,
        });
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        console.log(`Retry ${attempt + 1}/3 for settlement extraction...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    if (!txn) {
      console.warn('Transaction not found for settlement extraction');
      return null;
    }

    console.log('Transaction data:', JSON.stringify(txn, null, 2));

    // Look for BetSettledEvent in the transaction events
    if ('events' in txn && Array.isArray(txn.events)) {
      console.log(`Found ${txn.events.length} events in transaction`);
      
      for (const event of txn.events) {
        console.log('Event type:', event.type);
        
        // Match BetSettledEvent
        // Expected format: "0x<address>::tap_market::BetSettledEvent"
        if (event.type.includes('BetSettledEvent')) {
          console.log('✅ Found BetSettledEvent:', event.data);
          
          const data = event.data as Record<string, unknown>;
          
          return {
            betId: data.bet_id?.toString() || '0',
            user: data.user?.toString() || '',
            priceBucket: Number(data.price_bucket || 0),
            realizedBucket: Number(data.realized_bucket || 0),
            won: Boolean(data.won),
            stake: data.stake?.toString() || '0',
            payout: data.payout?.toString() || '0',
          };
        }
      }
    }
    
    console.warn('⚠️ Could not find BetSettledEvent in transaction events');
    return null;
  } catch (error) {
    console.error('Error extracting bet settlement from transaction:', error);
    return null;
  }
}

/**
 * Convert Move tokens to octas (1 MOVE = 10^8 octas)
 * 
 * @param moveAmount - Amount in MOVE tokens
 * @returns Amount in octas
 */
export function moveToOctas(moveAmount: number): bigint {
  return BigInt(Math.floor(moveAmount * 100_000_000));
}

/**
 * Convert octas to Move tokens (1 MOVE = 10^8 octas)
 * 
 * @param octas - Amount in octas (as string or number)
 * @returns Amount in MOVE tokens
 */
export function octasToMove(octas: string | number | bigint): number {
  const octasNum = typeof octas === 'bigint' ? octas : BigInt(octas);
  return Number(octasNum) / 100_000_000;
}

/**
 * Get account balance for a specific coin type
 * 
 * @param address - Account address
 * @param coinType - Coin type (defaults to COIN_TYPE from config)
 * @returns Balance as string in human-readable format (MOVE tokens)
 */
export async function getAccountBalance(
  address: string,
  coinType: string = COIN_TYPE
): Promise<string> {
  try {
    const balance = await aptosClient.getAccountCoinAmount({
      accountAddress: address,
      coinType: coinType as `${string}::${string}::${string}`,
    });
    return octasToMove(balance).toFixed(8);
  } catch (error) {
    console.error('Failed to fetch account balance:', error);
    return '0';
  }
}

/**
 * Format an address for display (show first and last few characters)
 * 
 * @param address - Full address
 * @param chars - Number of characters to show on each end (default: 6)
 * @returns Formatted address like "0x1234...5678"
 */
export function formatAddress(address: string, chars: number = 6): string {
  if (!address || address.length < chars * 2) {
    return address;
  }
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
