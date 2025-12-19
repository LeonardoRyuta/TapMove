/**
 * React hook for real-time Pyth price streaming
 * 
 * Uses Hermes SSE (Server-Sent Events) to stream live price updates
 * Documentation: https://docs.pyth.network/price-feeds/core/fetch-price-updates
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { pythPriceToFloat, getLatestPrice, HERMES_BASE_URL } from "../lib/pythHermesClient";

export interface PriceStreamData {
  latestPrice: number | null;
  publishTime: number | null; // Unix timestamp in seconds
  history: Array<{ timestamp: number; price: number }>;
  isLoading: boolean;
  isConnected: boolean;
  error: Error | null;
  rawData: {
    price: string;
    expo: number;
    conf: string;
  } | null;
}

interface UsePythPriceStreamOptions {
  maxHistoryPoints?: number; // Maximum number of historical points to keep
  historyDurationSeconds?: number; // Maximum age of historical data to keep
}

/**
 * Hook to stream real-time price updates from Pyth Network
 * 
 * @param priceId - Pyth price feed ID (e.g., ETH/USD)
 * @param options - Configuration options
 * @returns Price stream data and state
 */
export function usePythPriceStream(
  priceId: string,
  options: UsePythPriceStreamOptions = {}
): PriceStreamData {
  const {
    maxHistoryPoints = 500,
    historyDurationSeconds = 300, // 5 minutes default
  } = options;

  const [latestPrice, setLatestPrice] = useState<number | null>(null);
  const [publishTime, setPublishTime] = useState<number | null>(null);
  const [history, setHistory] = useState<Array<{ timestamp: number; price: number }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [rawData, setRawData] = useState<{ price: string; expo: number; conf: string } | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const BASE_RECONNECT_DELAY = 1000; // ms

  // Cleanup function
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      console.log("[Pyth] Closing SSE connection");
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Prune old history entries
  const pruneHistory = useCallback((currentHistory: Array<{ timestamp: number; price: number }>) => {
    const now = Date.now() / 1000;
    const cutoffTime = now - historyDurationSeconds;
    
    let pruned = currentHistory.filter(p => p.timestamp >= cutoffTime);
    
    // Also limit by max points
    if (pruned.length > maxHistoryPoints) {
      pruned = pruned.slice(pruned.length - maxHistoryPoints);
    }
    
    return pruned;
  }, [historyDurationSeconds, maxHistoryPoints]);

  // Initialize with latest price and start streaming
  useEffect(() => {
    let mounted = true;
    let eventSource: EventSource | null = null;

    const initializeAndStream = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Step 1: Fetch initial price snapshot
        console.log(`[Pyth] Fetching initial price for feed ${priceId.slice(0, 10)}...`);
        const initialData = await getLatestPrice(priceId);
        
        if (!mounted) return;

        console.log(`[Pyth] Initial price: $${initialData.priceFloat.toFixed(2)} at ${new Date(initialData.publishTime * 1000).toISOString()}`);
        
        setLatestPrice(initialData.priceFloat);
        setPublishTime(initialData.publishTime);
        setRawData({
          price: initialData.price,
          expo: initialData.expo,
          conf: "0", // Not provided in initial fetch
        });
        
        // Initialize history with the initial point
        setHistory([{
          timestamp: initialData.publishTime,
          price: initialData.priceFloat,
        }]);

        // Step 2: Subscribe to streaming updates
        console.log(`[Pyth] Starting SSE stream for feed ${priceId.slice(0, 10)}...`);
        
        // Create SSE connection using Hermes client
        const streamUrl = `${HERMES_BASE_URL}/v2/updates/price/stream?ids[]=${priceId}&encoding=hex&parsed=true`;
        eventSource = new EventSource(streamUrl);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          if (!mounted) return;
          console.log("[Pyth] SSE connection opened");
          setIsConnected(true);
          setIsLoading(false);
          reconnectAttemptsRef.current = 0;
        };

        eventSource.onmessage = (event) => {
          if (!mounted) return;
          
          try {
            const data = JSON.parse(event.data);
            
            // Parse the price update
            if (data.parsed && data.parsed.length > 0) {
              const update = data.parsed[0];
              const price = update.price.price;
              const expo = update.price.expo;
              const conf = update.price.conf;
              const publishTimeSeconds = update.price.publish_time;
              
              const priceFloat = pythPriceToFloat(price, expo);
              
              // Update state
              setLatestPrice(priceFloat);
              setPublishTime(publishTimeSeconds);
              setRawData({ price, expo, conf });
              
              // Add to history
              setHistory(prev => {
                const updated = [
                  ...prev,
                  { timestamp: publishTimeSeconds, price: priceFloat }
                ];
                return pruneHistory(updated);
              });
              
              // Log periodically (every 10 seconds)
              if (publishTimeSeconds % 10 === 0) {
                console.log(`[Pyth] Price update: $${priceFloat.toFixed(2)} @ ${new Date(publishTimeSeconds * 1000).toISOString()}`);
              }
            }
          } catch (err) {
            console.error("[Pyth] Error parsing SSE message:", err);
          }
        };

        eventSource.onerror = (err) => {
          console.error("[Pyth] SSE error:", err);
          
          if (!mounted) return;
          
          setIsConnected(false);
          setError(new Error("Price stream connection error"));
          
          // Close the failed connection
          if (eventSource) {
            eventSource.close();
          }
          
          // Attempt reconnection with exponential backoff
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current);
            reconnectAttemptsRef.current += 1;
            
            console.log(`[Pyth] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);
            
            reconnectTimeoutRef.current = setTimeout(() => {
              if (mounted) {
                initializeAndStream();
              }
            }, delay);
          } else {
            console.error("[Pyth] Max reconnection attempts reached");
            setError(new Error("Failed to maintain price stream connection"));
          }
        };

      } catch (err) {
        if (!mounted) return;
        
        console.error("[Pyth] Failed to initialize price stream:", err);
        setError(err instanceof Error ? err : new Error("Failed to initialize price stream"));
        setIsLoading(false);
      }
    };

    initializeAndStream();

    // Cleanup on unmount
    return () => {
      mounted = false;
      cleanup();
    };
  }, [priceId, cleanup, pruneHistory]);

  return {
    latestPrice,
    publishTime,
    history,
    isLoading,
    isConnected,
    error,
    rawData,
  };
}
