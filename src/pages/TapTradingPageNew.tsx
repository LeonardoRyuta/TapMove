/**
 * TapTradingPage - Euphoria-style full-screen trading interface
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { usePrivyMovementWallet } from "../hooks/usePrivyMovementWallet";
import { useTapMarket, useGridState, calculateMultiplier } from "../hooks/useTapMarket";
import { usePythPriceStream } from "../hooks/usePythPriceStream";
import { PYTH_PRICE_IDS } from "../lib/pythHermesClient";
import { TradingHeader } from "../components/TradingHeader";
import { DramaticChartWithGrid, type GridCell } from "../components/DramaticChartWithGrid";
import { FloatingStakeControl } from "../components/FloatingStakeControl";
import { ToastContainer, type ToastType } from "../components/Toast";
import {
  NUM_PRICE_BUCKETS,
  NUM_VISIBLE_TIME_COLUMNS,
  TIME_BUCKET_SECONDS,
  MIN_BET_SIZE,
  MAX_BET_SIZE,
} from "../config/tapMarket";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface SelectedCell {
  rowIndex: number;
  columnIndex: number;
  multiplier: number;
}

export function TapTradingPage() {
  const { ready, authenticated, login, logout, address, aptosSigner, refreshBalance, balance } =
    usePrivyMovementWallet();
  const { placeBet, isPlacing, error: placeBetError, clearError } = useTapMarket(address, aptosSigner);
  const { currentBucket, earliestBettableBucket } = useGridState();

  // Real-time price streaming from Pyth
  const {
    latestPrice,
    publishTime,
    history: priceHistory,
    isConnected: isPriceConnected,
  } = usePythPriceStream(PYTH_PRICE_IDS.ETH_USD, {
    maxHistoryPoints: 500,
    historyDurationSeconds: 300,
  });

  // UI State
  const [stakeAmount, setStakeAmount] = useState<bigint>(1_000_000n);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set());
  const [placedCells, setPlacedCells] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Convert Pyth history to price data
  const priceData = useMemo(() => {
    return priceHistory.map(point => ({
      timestamp: point.timestamp,
      price: point.price,
    }));
  }, [priceHistory]);

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

  // Generate grid cells with states
  const gridCells = useMemo((): GridCell[] => {
    const cells: GridCell[] = [];
    
    for (let row = 0; row < NUM_PRICE_BUCKETS; row++) {
      for (let col = 0; col < NUM_VISIBLE_TIME_COLUMNS; col++) {
        const cellKey = `${row}-${col}`;
        const targetBucket = earliestBettableBucket + col;
        const isLocked = targetBucket < earliestBettableBucket;
        
        cells.push({
          rowIndex: row,
          columnIndex: col,
          multiplier: multipliers[row][col],
          isLocked,
          isSelected: selectedCell?.rowIndex === row && selectedCell?.columnIndex === col,
          isPending: pendingCells.has(cellKey),
          isPlaced: placedCells.has(cellKey),
        });
      }
    }
    
    return cells;
  }, [multipliers, selectedCell, pendingCells, placedCells, earliestBettableBucket]);

  // Toast management
  const addToast = useCallback((message: string, type: ToastType) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Refresh balance periodically
  useEffect(() => {
    refreshBalance();
    const interval = setInterval(refreshBalance, 10000); // Every 10 seconds
    return () => clearInterval(interval);
  }, [refreshBalance]);

  // Handle bet placement error
  useEffect(() => {
    if (placeBetError) {
      addToast(placeBetError, "error");
      clearError();
    }
  }, [placeBetError, addToast, clearError]);

  /**
   * Handle cell click - place a bet
   */
  const handleCellClick = async (rowIndex: number, columnIndex: number, multiplier: number) => {
    if (!authenticated) {
      addToast("Please connect your wallet first", "info");
      return;
    }

    if (isPlacing) {
      return;
    }

    // Set as selected cell with locked multiplier
    setSelectedCell({ rowIndex, columnIndex, multiplier });

    const cellKey = `${rowIndex}-${columnIndex}`;
    setPendingCells(prev => new Set(prev).add(cellKey));

    try {
      await placeBet({
        rowIndex,
        columnIndex,
        stakeAmount: stakeAmount.toString(),
      });

      // Success
      setPendingCells(prev => {
        const newSet = new Set(prev);
        newSet.delete(cellKey);
        return newSet;
      });
      setPlacedCells(prev => new Set(prev).add(cellKey));
      
      const stakeInMove = (Number(stakeAmount) / 100_000_000).toFixed(4);
      addToast(`Bet placed: ${stakeInMove} MOVE at ${multiplier.toFixed(2)}x`, "success");
      
      // Refresh balance after successful bet
      await refreshBalance();
      
      // Clear selection after a moment
      setTimeout(() => setSelectedCell(null), 2000);
    } catch (err) {
      // Error
      setPendingCells(prev => {
        const newSet = new Set(prev);
        newSet.delete(cellKey);
        return newSet;
      });
      
      const errorMessage = err instanceof Error ? err.message : "Failed to place bet";
      addToast(errorMessage, "error");
    }
  };

  // If not authenticated, show connect wallet screen
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#050816] via-[#0b1020] to-[#0a0618] flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="mb-8 flex justify-center">
            <div className="w-24 h-24 bg-gradient-to-br from-pink-500 to-purple-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-purple-500/30">
              <span className="text-white font-bold text-4xl">T</span>
            </div>
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">Tap Trading</h1>
          <p className="text-purple-300 mb-8 text-lg">
            Predict future price movements. Win big with multipliers.
          </p>
          <button
            onClick={login}
            disabled={!ready}
            className="px-8 py-4 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-bold text-lg transition-all shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/50"
          >
            {ready ? "Connect Wallet to Start" : "Loading..."}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#050816] via-[#0b1020] to-[#0a0618] flex flex-col">
      {/* Header */}
      <TradingHeader
        isPriceConnected={isPriceConnected}
        latestPrice={latestPrice}
        balance={balance}
        address={address}
        authenticated={authenticated}
        ready={ready}
        onLogin={login}
        onLogout={logout}
      />

      {/* Main Chart Area */}
      <div className="flex-1 pt-16 relative">
        <div className="absolute inset-0 mt-16">
          <DramaticChartWithGrid
            priceData={priceData}
            latestPrice={latestPrice}
            publishTime={publishTime}
            numPriceBuckets={NUM_PRICE_BUCKETS}
            numTimeColumns={NUM_VISIBLE_TIME_COLUMNS}
            timeBucketSeconds={TIME_BUCKET_SECONDS}
            gridCells={gridCells}
            onCellClick={handleCellClick}
            currentBucket={currentBucket}
          />
        </div>
      </div>

      {/* Floating Stake Control */}
      <FloatingStakeControl
        stakeAmount={stakeAmount}
        onStakeChange={setStakeAmount}
        minBet={MIN_BET_SIZE}
        maxBet={MAX_BET_SIZE}
        balance={balance !== null ? BigInt(Math.floor(balance)) : null}
      />

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
