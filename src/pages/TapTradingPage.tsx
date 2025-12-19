/**
 * TapTradingPage - Main trading interface
 * 
 * Full-screen trading experience with:
 * - Live price chart
 * - Betting grid overlay
 * - Wallet and stake controls
 * - Bet history
 */

import { useState, useEffect, useMemo } from "react";
import { usePrivyMovementWallet } from "../hooks/usePrivyMovementWallet";
import { useTapMarket, useGridState, calculateMultiplier } from "../hooks/useTapMarket";
import { PriceChartWithGrid } from "../components/PriceChartWithGrid";
import { usePythPriceStream } from "../hooks/usePythPriceStream";
import { PYTH_PRICE_IDS } from "../lib/pythHermesClient";
import {
  NUM_PRICE_BUCKETS,
  NUM_VISIBLE_TIME_COLUMNS,
  TIME_BUCKET_SECONDS,
  MIN_BET_SIZE,
  MAX_BET_SIZE,
} from "../config/tapMarket";
import { WalletIcon, TrendingUpIcon, AlertCircleIcon, CheckCircleIcon, ActivityIcon } from "lucide-react";

interface BetState {
  rowIndex: number;
  columnIndex: number;
  multiplier: number; // Locked multiplier at time of selection
  stake: string;
  status: "pending" | "placed" | "error";
  txHash?: string;
  errorMessage?: string;
}

export function TapTradingPage() {
  const { ready, authenticated, login, logout, address, aptosAccount, aptosSigner, refreshBalance, balance } =
    usePrivyMovementWallet();
  const { placeBet, isPlacing, error: placeBetError, clearError } = useTapMarket(address, aptosSigner);
  const { currentBucket, earliestBettableBucket } = useGridState();

  // Real-time price streaming from Pyth
  const { 
    latestPrice, 
    publishTime, 
    history: priceHistory, 
    isLoading: isPriceLoading,
    isConnected: isPriceConnected,
    error: priceError,
    rawData: rawPriceData,
  } = usePythPriceStream(PYTH_PRICE_IDS.ETH_USD, {
    maxHistoryPoints: 500,
    historyDurationSeconds: 300, // 5 minutes
  });

  // UI State
  const [stakeAmount, setStakeAmount] = useState<bigint>(1_000_000n); // 0.00001 MOVE in octas
  const [stakeInput, setStakeInput] = useState("1000000");
  const [bets, setBets] = useState<Map<string, BetState>>(new Map());
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showDevMode, setShowDevMode] = useState(false);

  // Convert Pyth history format to PricePoint format for chart
  const priceData = useMemo(() => {
    return priceHistory.map(point => ({
      timestamp: point.timestamp,
      price: point.price,
    }));
  }, [priceHistory]);

  useEffect(() => {
    // Refresh balance on mount and after placing bets
    refreshBalance();
  }, [refreshBalance, isPlacing]);

  // Clear success message after 5 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Generate multipliers matrix
  const multipliers = useMemo(() => {
    const matrix: number[][] = [];
    for (let row = 0; row < NUM_PRICE_BUCKETS; row++) {
      const rowMultipliers: number[] = [];
      for (let col = 0; col < NUM_VISIBLE_TIME_COLUMNS; col++) {
        rowMultipliers.push(calculateMultiplier(row, col));
      }
      matrix.push(rowMultipliers);
    }
    return matrix;
  }, []);

  // Determine cell states for visualization
  const selectedCells = useMemo(() => {
    const set = new Set<string>();
    bets.forEach((bet, key) => {
      if (bet.status === "pending" || bet.status === "placed") {
        set.add(key);
      }
    });
    return set;
  }, [bets]);

  const pendingCells = useMemo(() => {
    const set = new Set<string>();
    bets.forEach((bet, key) => {
      if (bet.status === "pending") {
        set.add(key);
      }
    });
    return set;
  }, [bets]);

  const placedCells = useMemo(() => {
    const map = new Map<string, { stake: string; txHash?: string }>();
    bets.forEach((bet, key) => {
      if (bet.status === "placed") {
        map.set(key, { stake: bet.stake, txHash: bet.txHash });
      }
    });
    return map;
  }, [bets]);

  /**
   * Handle stake input change
   */
  const handleStakeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setStakeInput(value);

    try {
      const parsed = BigInt(value);
      if (parsed >= MIN_BET_SIZE && parsed <= MAX_BET_SIZE) {
        setStakeAmount(parsed);
      }
    } catch (err) {
      console.error("Invalid stake input:", err);
    }
  };

  /**
   * Handle cell click - place a bet
   * The multiplier passed here is "locked in" at the time of click
   */
  const handleCellClick = async (rowIndex: number, columnIndex: number, multiplier: number) => {
    if (!authenticated || !aptosAccount) {
      alert("Please connect your wallet to place bets");
      return;
    }

    const cellKey = `${rowIndex}-${columnIndex}`;

    // Prevent double-betting on same cell
    if (bets.has(cellKey)) {
      alert("You already have a bet on this cell");
      return;
    }

    // Create pending bet state with locked multiplier
    const newBet: BetState = {
      rowIndex,
      columnIndex,
      multiplier, // This multiplier is locked and won't change
      stake: stakeAmount.toString(),
      status: "pending",
    };

    setBets(prev => new Map(prev).set(cellKey, newBet));
    clearError();

    try {
      // Place the bet on-chain
      const txHash = await placeBet({
        rowIndex,
        columnIndex,
        stakeAmount: stakeAmount.toString(),
      });

      // Update bet state to placed
      setBets(prev => {
        const updated = new Map(prev);
        const bet = updated.get(cellKey);
        if (bet) {
          bet.status = "placed";
          bet.txHash = txHash;
        }
        return updated;
      });

      setSuccessMessage(`Bet placed! Multiplier locked at ${multiplier.toFixed(2)}x`);
      console.log("Bet placed successfully:", { cellKey, txHash, multiplier });
    } catch (err) {
      // Update bet state to error
      const errorMessage = err instanceof Error ? err.message : "Failed to place bet";
      setBets(prev => {
        const updated = new Map(prev);
        const bet = updated.get(cellKey);
        if (bet) {
          bet.status = "error";
          bet.errorMessage = errorMessage;
        }
        return updated;
      });
      
      // Remove error bet after 3 seconds
      setTimeout(() => {
        setBets(prev => {
          const updated = new Map(prev);
          updated.delete(cellKey);
          return updated;
        });
      }, 3000);

      console.error("Failed to place bet:", err);
    }
  };

  // Get recent bets for history display
  const recentBets = useMemo(() => {
    return Array.from(bets.entries())
      .map(([key, bet]) => ({ key, ...bet }))
      .sort((a, b) => {
        // Sort by status (pending first, then placed, then errors)
        const statusOrder = { pending: 0, placed: 1, error: 2 };
        return statusOrder[a.status] - statusOrder[b.status];
      })
      .slice(0, 10); // Show last 10 bets
  }, [bets]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top bar */}
      <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <div className="max-w-500 mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TrendingUpIcon size={28} className="text-green-500" />
            <h1 className="text-2xl font-bold bg-linear-to-r from-green-400 to-blue-500 bg-clip-text text-transparent">
              Tap Trading
            </h1>
            <span className="text-xs text-slate-500 font-mono">Movement Testnet</span>
            
            {/* Price feed status indicator */}
            <div className="flex items-center gap-2 px-3 py-1 bg-slate-800/50 rounded-full border border-slate-700">
              <ActivityIcon 
                size={14} 
                className={isPriceConnected ? "text-green-400 animate-pulse" : "text-red-400"} 
              />
              <span className="text-xs font-mono">
                {isPriceLoading ? "Connecting..." : isPriceConnected ? "Live ETH/USD" : "Disconnected"}
              </span>
              {latestPrice && (
                <span className="text-xs font-bold text-green-400">
                  ${latestPrice.toFixed(2)}
                </span>
              )}
            </div>
            
            {/* Dev mode toggle */}
            <button
              onClick={() => setShowDevMode(!showDevMode)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              title="Toggle developer mode"
            >
              {showDevMode ? "🔧 ON" : "🔧"}
            </button>
          </div>

          {/* Wallet connection */}
          <div className="flex items-center gap-4">
            {!ready && <p className="text-slate-400 text-sm">Loading...</p>}

            {ready && !authenticated && (
              <button
                onClick={login}
                className="px-6 py-2.5 bg-linear-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 rounded-lg font-semibold transition-all duration-200 shadow-lg hover:shadow-xl flex items-center gap-2"
              >
                <WalletIcon size={18} />
                Connect Wallet
              </button>
            )}

            {ready && authenticated && (
              <div className="flex items-center gap-3">
                {/* Balance */}
                <div className="text-sm text-slate-300 font-mono">
                  Balance: {/* Placeholder for balance - implement fetching balance as needed */}
                  <span className="font-bold">{balance !== null ? balance.toFixed(2) : '--.--'} MOVE</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-lg border border-slate-700">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm font-mono text-slate-300 hover:cursor-pointer" onClick={() => {
                    navigator.clipboard.writeText(address || "");
                  }}>
                    {address?.slice(0, 6)}...{address?.slice(-4)}
                  </span>
                </div>
                <button
                  onClick={logout}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm transition-colors border border-slate-700"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-500 mx-auto p-6">
        {!authenticated ? (
          /* Pre-login state - centered call to action */
          <div className="flex items-center justify-center h-[calc(100vh-200px)]">
            <div className="text-center max-w-md">
              <div className="mb-6 flex justify-center">
                <div className="w-20 h-20 bg-linear-to-br from-green-500 to-blue-500 rounded-2xl flex items-center justify-center">
                  <TrendingUpIcon size={40} className="text-white" />
                </div>
              </div>
              <h2 className="text-3xl font-bold mb-3">Welcome to Tap Trading</h2>
              <p className="text-slate-400 mb-8">
                Connect your wallet to start trading on Movement blockchain. Predict future price movements and earn multipliers on your bets.
              </p>
              <button
                onClick={login}
                className="px-8 py-4 bg-linear-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 rounded-xl font-semibold text-lg transition-all duration-200 shadow-xl hover:shadow-2xl flex items-center gap-3 mx-auto"
              >
                <WalletIcon size={22} />
                Connect Wallet to Start
              </button>
            </div>
          </div>
        ) : (
          /* Main trading interface */
          <>
            {/* Developer mode panel */}
            {showDevMode && (
              <div className="mb-4 bg-slate-900 rounded-xl border border-yellow-500/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-yellow-400">🔧 Developer Mode</h3>
                  <button
                    onClick={() => setShowDevMode(false)}
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >
                    Close
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                  <div>
                    <span className="text-slate-500">Status:</span>
                    <span className={`ml-2 font-bold ${isPriceConnected ? 'text-green-400' : 'text-red-400'}`}>
                      {isPriceConnected ? '✓ Connected' : '✗ Disconnected'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Loading:</span>
                    <span className="ml-2 text-slate-300">{isPriceLoading ? 'Yes' : 'No'}</span>
                  </div>
                  {rawPriceData && (
                    <>
                      <div>
                        <span className="text-slate-500">Raw Price:</span>
                        <span className="ml-2 text-slate-300">{rawPriceData.price}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Exponent:</span>
                        <span className="ml-2 text-slate-300">{rawPriceData.expo}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Float Price:</span>
                        <span className="ml-2 text-green-400 font-bold">
                          ${latestPrice?.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Confidence:</span>
                        <span className="ml-2 text-slate-300">{rawPriceData.conf}</span>
                      </div>
                    </>
                  )}
                  {publishTime && (
                    <>
                      <div>
                        <span className="text-slate-500">Publish Time:</span>
                        <span className="ml-2 text-slate-300">{publishTime}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Time (ISO):</span>
                        <span className="ml-2 text-slate-300">
                          {new Date(publishTime * 1000).toISOString()}
                        </span>
                      </div>
                    </>
                  )}
                  <div>
                    <span className="text-slate-500">History Points:</span>
                    <span className="ml-2 text-slate-300">{priceHistory.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Current Bucket:</span>
                    <span className="ml-2 text-slate-300">{currentBucket}</span>
                  </div>
                  {priceError && (
                    <div className="col-span-2">
                      <span className="text-slate-500">Error:</span>
                      <span className="ml-2 text-red-400">{priceError.message}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[1fr,320px] gap-6">
            {/* Chart + Grid */}
            <div className="h-[calc(100vh-180px)] min-h-150">
              <PriceChartWithGrid
                priceData={priceData}
                numPriceBuckets={NUM_PRICE_BUCKETS}
                numTimeColumns={NUM_VISIBLE_TIME_COLUMNS}
                multipliers={multipliers}
                selectedCells={selectedCells}
                pendingCells={pendingCells}
                placedCells={placedCells}
                onCellClick={handleCellClick}
                earliestBettableBucket={earliestBettableBucket}
              />
            </div>

            {/* Side panel - Controls & History */}
            <div className="flex flex-col gap-4">
              {/* Stake controls */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  Bet Configuration
                </h3>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="stake-input" className="block text-sm font-medium text-slate-400 mb-2">
                      Stake Amount (octas)
                    </label>
                    <input
                      id="stake-input"
                      type="text"
                      value={stakeInput}
                      onChange={handleStakeChange}
                      disabled={isPlacing}
                      className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder="Enter stake amount"
                    />
                    <div className="mt-2 flex justify-between text-xs text-slate-500">
                      <span>Min: {(Number(MIN_BET_SIZE) / 100_000_000).toFixed(8)} MOVE</span>
                      <span>Max: {(Number(MAX_BET_SIZE) / 100_000_000).toFixed(2)} MOVE</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      ≈ {(Number(stakeAmount) / 100_000_000).toFixed(6)} MOVE
                    </p>
                  </div>

                  {/* Quick stake buttons */}
                  <div className="grid grid-cols-3 gap-2">
                    {[0.001, 0.01, 0.1].map(move => (
                      <button
                        key={move}
                        onClick={() => {
                          const octas = BigInt(Math.floor(move * 100_000_000));
                          setStakeAmount(octas);
                          setStakeInput(octas.toString());
                        }}
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors border border-slate-700"
                      >
                        {move} MOVE
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Success message */}
              {successMessage && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-start gap-3">
                  <CheckCircleIcon size={20} className="text-green-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-green-400 font-medium">{successMessage}</p>
                  </div>
                </div>
              )}

              {/* Error message */}
              {placeBetError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircleIcon size={20} className="text-red-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-red-400">{placeBetError}</p>
                    <button
                      onClick={clearError}
                      className="text-xs text-red-400 hover:text-red-300 mt-1 underline"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Recent bets */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 flex-1 overflow-hidden flex flex-col">
                <h3 className="text-lg font-bold mb-4">Recent Bets</h3>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {recentBets.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-8">
                      No bets yet. Click a cell on the grid to place your first bet!
                    </p>
                  ) : (
                    recentBets.map(bet => (
                      <div
                        key={bet.key}
                        className={`p-3 rounded-lg border transition-all ${
                          bet.status === "pending"
                            ? "bg-yellow-500/5 border-yellow-500/30"
                            : bet.status === "placed"
                            ? "bg-blue-500/5 border-blue-500/30"
                            : "bg-red-500/5 border-red-500/30"
                        }`}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-xs font-mono text-slate-400">
                            Cell [{bet.rowIndex}, {bet.columnIndex}]
                          </span>
                          <span
                            className={`text-xs font-bold ${
                              bet.status === "pending"
                                ? "text-yellow-400"
                                : bet.status === "placed"
                                ? "text-blue-400"
                                : "text-red-400"
                            }`}
                          >
                            {bet.multiplier.toFixed(2)}x
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500">
                            {(Number(bet.stake) / 100_000_000).toFixed(4)} MOVE
                          </span>
                          <span
                            className={`font-medium ${
                              bet.status === "pending"
                                ? "text-yellow-400"
                                : bet.status === "placed"
                                ? "text-green-400"
                                : "text-red-400"
                            }`}
                          >
                            {bet.status === "pending" && "⏳ Pending..."}
                            {bet.status === "placed" && "✓ Placed"}
                            {bet.status === "error" && "✗ Error"}
                          </span>
                        </div>
                        {bet.txHash && (
                          <div className="mt-1 text-xs font-mono text-slate-600 truncate">
                            {bet.txHash.slice(0, 8)}...{bet.txHash.slice(-6)}
                          </div>
                        )}
                        {bet.errorMessage && (
                          <div className="mt-1 text-xs text-red-400">{bet.errorMessage}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Info panel */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Current Bucket:</span>
                    <span className="font-mono text-slate-300">{currentBucket}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">First Bettable:</span>
                    <span className="font-mono text-slate-300">{earliestBettableBucket}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Bucket Duration:</span>
                    <span className="font-mono text-slate-300">{TIME_BUCKET_SECONDS}s</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
