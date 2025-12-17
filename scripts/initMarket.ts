/**
 * Example: Admin script to initialize a new TapMarket
 * 
 * This script shows how to deploy/initialize a market from Node.js
 * Run with: npx ts-node scripts/initMarket.ts
 */

import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import { initMarket, type InitMarketArgs } from "../src/aptos/tapMarketClient";

async function main() {
  // Load admin private key from environment
  const privateKeyHex = process.env.ADMIN_PRIVATE_KEY;
  if (!privateKeyHex) {
    throw new Error("ADMIN_PRIVATE_KEY environment variable not set");
  }

  // Create admin account
  const privateKey = new Ed25519PrivateKey(privateKeyHex);
  const adminAccount = Account.fromPrivateKey({ privateKey });
  
  console.log("Admin address:", adminAccount.accountAddress.toString());

  // Example Pyth BTC/USD price feed ID (mainnet)
  // Get this from https://pyth.network/developers/price-feed-ids
  const pythBtcUsdFeedId = new Uint8Array([
    0xe6, 0x2d, 0xf6, 0xc8, 0xb4, 0xa8, 0x54, 0x97,
    0xa6, 0x0e, 0x0e, 0x74, 0x81, 0xd1, 0x1c, 0xe9,
    0x93, 0xd1, 0x30, 0xd2, 0x20, 0x91, 0x43, 0x03,
    0x1e, 0x47, 0x93, 0x66, 0x94, 0x76, 0x32, 0xfe,
  ]);

  // Market configuration
  const config: InitMarketArgs = {
    // Grid size
    numPriceBuckets: 15,          // 15 rows (price buckets)
    midPriceBucket: 7,            // Row 7 is the "current price"
    
    // Time configuration
    timeBucketSeconds: 10,        // Each column = 10 seconds
    maxExpiryBucketsAhead: 100,   // Can bet up to 1000 seconds ahead
    lockedColumnsAhead: 1,        // Can't bet on current or next 1 column
    
    // Bet limits
    minBetSize: 100_000,          // 0.001 coins (assuming 8 decimals)
    maxBetSize: 1_000_000_000,    // 10 coins
    maxOpenBetsPerUser: 50,       // Max concurrent bets per user
    
    // Price mapping (example for BTC at $50,000)
    // Pyth prices use 8 decimals, so $50,000 = 5000000000000
    anchorPriceMagnitude: "5000000000000", // $50,000 (price at mid bucket)
    anchorPriceNegative: false,
    
    // Each bucket represents $100 difference
    bucketSizeMagnitude: "10000000000",    // $100 per bucket
    bucketSizeNegative: false,
    
    // Pyth price feed
    priceFeedId: pythBtcUsdFeedId,
    
    // Initial house liquidity (100 coins)
    initialHouseLiquidityAmount: "10000000000", // 100 coins (assuming 8 decimals)
  };

  console.log("\nInitializing market with config:");
  console.log(JSON.stringify(config, null, 2));
  console.log("\nThis will:");
  console.log("1. Create a Market<CoinType> resource under your address");
  console.log("2. Deposit initial liquidity from your account to house vault");
  console.log("3. Configure the grid parameters");
  
  // Confirm before proceeding
  console.log("\nPress Ctrl+C to cancel, or wait 5 seconds to continue...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    console.log("\nInitializing market...");
    const txHash = await initMarket(adminAccount, config);
    
    console.log("\n✅ Market initialized successfully!");
    console.log("Transaction hash:", txHash);
    console.log("\nYour market is now live at address:", adminAccount.accountAddress.toString());
    console.log("\nUpdate your frontend config:");
    console.log(`export const MARKET_ADMIN_ADDRESS = "${adminAccount.accountAddress.toString()}";`);
    
  } catch (error) {
    console.error("\n❌ Failed to initialize market:");
    console.error(error);
    process.exit(1);
  }
}

main().catch(console.error);
