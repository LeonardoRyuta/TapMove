// ============================================================
// Pyth Hermes Integration
// ============================================================

import { HERMES_BASE_URL, PYTH_PRICE_IDS } from "./pythHermesClient";
import type { PricePoint } from "../types";

// Default to ETH/USD feed
const DEFAULT_FEED_ID = PYTH_PRICE_IDS.ETH_USD;

// ============================================================
// Fetch latest price for UI display
// ============================================================
export async function fetchLatestPrice(feedIdHex: string = DEFAULT_FEED_ID): Promise<PricePoint | null> {
  try {
    const url = `${HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${feedIdHex}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error("Pyth API error:", response.status, response.statusText);
      return null;
    }
    
    const data = await response.json();
    
    if (!data.parsed || data.parsed.length === 0) {
      console.error("No price data in Pyth response");
      return null;
    }
    
    const priceData = data.parsed[0].price;
    const priceRaw = parseInt(priceData.price);
    const expo = priceData.expo;
    const publishTime = parseInt(priceData.publish_time);
    
    // Convert to USD (Pyth gives price with exponent, e.g., expo = -8)
    const price = priceRaw * Math.pow(10, expo);
    
    // Reduced logging to prevent spam
    // console.log(`[Pyth] Latest price: $${price.toFixed(2)} at ${new Date(publishTime * 1000).toISOString()}`);
    
    return { price, timestamp: publishTime * 1000 }; // Convert seconds to milliseconds
  } catch (error) {
    console.error("Error fetching Pyth price:", error);
    return null;
  }
}

// ============================================================
// Fetch price update bytes for settlement
// ============================================================
export async function fetchLatestPriceUpdate(feedIdHex: string = DEFAULT_FEED_ID): Promise<Uint8Array[]> {
  try {
    const url = `${HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${feedIdHex}&encoding=hex`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Pyth API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.binary || !data.binary.data || data.binary.data.length === 0) {
      throw new Error("No binary update data in Pyth response");
    }
    
    // Hermes returns hex strings in the format: ["0x..."]
    // We need to convert them to Uint8Array[]
    const updateBytes: Uint8Array[] = data.binary.data.map((hexString: string) => {
      // Remove 0x prefix if present
      const hex = hexString.startsWith("0x") ? hexString.slice(2) : hexString;
      // Convert hex to Uint8Array
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
      }
      return bytes;
    });
    
    console.log(`[Pyth] Fetched ${updateBytes.length} price update(s), total size: ${updateBytes.reduce((sum, arr) => sum + arr.length, 0)} bytes`);
    
    return updateBytes;
  } catch (error) {
    console.error("Error fetching Pyth price update:", error);
    throw error;
  }
}

// ============================================================
// Fetch historical price update for specific timestamp
// ============================================================
export async function fetchPriceUpdateAtTime(
  feedIdHex: string = DEFAULT_FEED_ID,
  targetTimestamp: number
): Promise<Uint8Array[]> {
  try {
    // Try to get price at or after target timestamp
    const url = `${HERMES_BASE_URL}/v2/updates/price/${targetTimestamp}?ids[]=${feedIdHex}&encoding=hex`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn(`No price update at ${targetTimestamp}, falling back to latest`);
      return fetchLatestPriceUpdate(feedIdHex);
    }
    
    const data = await response.json();
    
    if (!data.binary || !data.binary.data || data.binary.data.length === 0) {
      console.warn("No binary update data, falling back to latest");
      return fetchLatestPriceUpdate(feedIdHex);
    }
    
    const updateBytes: Uint8Array[] = data.binary.data.map((hexString: string) => {
      const hex = hexString.startsWith("0x") ? hexString.slice(2) : hexString;
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
      }
      return bytes;
    });
    
    console.log(`[Pyth] Fetched historical price update for timestamp ${targetTimestamp}`);
    
    return updateBytes;
  } catch (error) {
    console.error("Error fetching historical Pyth price update:", error);
    return fetchLatestPriceUpdate(feedIdHex);
  }
}

// ============================================================
// Helper: Get price from update bytes (for debugging)
// ============================================================
export async function getPriceFromUpdate(feedIdHex: string = DEFAULT_FEED_ID): Promise<PricePoint | null> {
  return fetchLatestPrice(feedIdHex);
}
