/**
 * Pyth Hermes client wrapper for real-time price feeds
 * 
 * Documentation: https://docs.pyth.network/price-feeds/core/fetch-price-updates
 */

import { HermesClient } from "@pythnetwork/hermes-client";

// Hermes endpoint - can be overridden via environment variable
export const HERMES_BASE_URL = import.meta.env.VITE_HERMES_URL || "https://hermes.pyth.network";

// Create singleton Hermes client instance
export const hermesClient = new HermesClient(HERMES_BASE_URL, {});

// Price feed IDs for common assets
// Full list: https://pyth.network/developers/price-feed-ids
export const PYTH_PRICE_IDS = {
  ETH_USD: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  BTC_USD: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  SOL_USD: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
} as const;

/**
 * Convert Pyth price data to a float number
 * 
 * Pyth prices are represented as price * 10^expo
 * Example: price = "6163260000000", expo = -8 → 61632.6
 * 
 * @param price - Price as bigint or string
 * @param expo - Exponent for the price
 * @returns Floating point price
 */
export function pythPriceToFloat(price: string | bigint, expo: number): number {
  const priceNum = typeof price === 'string' ? BigInt(price) : price;
  const priceFloat = Number(priceNum);
  return priceFloat * Math.pow(10, expo);
}

/**
 * Helper to get the latest price for a single feed
 * 
 * @param priceId - Pyth price feed ID
 * @returns Object with price, expo, and publish_time
 */
export async function getLatestPrice(priceId: string) {
  const updates = await hermesClient.getLatestPriceUpdates([priceId]);
  
  if (!updates.parsed || updates.parsed.length === 0) {
    throw new Error(`No price data returned for feed ${priceId}`);
  }
  
  const priceData = updates.parsed[0];
  const price = priceData.price.price;
  const expo = priceData.price.expo;
  const publishTime = priceData.price.publish_time;
  
  return {
    price,
    expo,
    publishTime,
    priceFloat: pythPriceToFloat(price, expo),
  };
}
