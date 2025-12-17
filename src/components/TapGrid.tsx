/**
 * TapGrid component - Interactive grid for placing bets
 * 
 * Displays a grid where:
 * - Y-axis (rows) = price buckets (different price ranges)
 * - X-axis (columns) = future time buckets
 * 
 * Users tap/click cells to place bets.
 * Locked columns are visually distinguished.
 */

import React, { useState, useEffect } from "react";
import { Account } from "@aptos-labs/ts-sdk";
import { useTapMarket, useGridState, calculateMultiplier } from "../hooks/useTapMarket";
import { MARKET_CONFIG, UI_CONFIG } from "../aptos/config";

interface TapGridProps {
  account: Account | null; // From Privy or other wallet provider
  defaultStakeAmount?: string; // Default bet amount
  onBetPlaced?: (txHash: string) => void; // Callback when bet is placed
}

interface CellState {
  rowIndex: number;
  columnIndex: number;
  isLocked: boolean;
  isCurrent: boolean;
  multiplier: number;
}

export function TapGrid({ account, defaultStakeAmount = "1000000", onBetPlaced }: TapGridProps) {
  const { placeBet, isPlacing, error, clearError } = useTapMarket(account);
  const { currentBucket, earliestBettableBucket } = useGridState();
  
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [stakeAmount, setStakeAmount] = useState(defaultStakeAmount);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update current time every second for real-time locked column updates
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, UI_CONFIG.gridRefreshIntervalMs);
    return () => clearInterval(interval);
  }, []);

  /**
   * Handle cell click - place a bet
   */
  const handleCellClick = async (rowIndex: number, columnIndex: number) => {
    if (!account) {
      alert("Please connect your wallet first");
      return;
    }

    // Check if cell is locked
    const cellState = getCellState(rowIndex, columnIndex);
    if (cellState.isLocked) {
      alert("This time column is locked. Choose a future column.");
      return;
    }

    if (isPlacing) {
      return; // Prevent double-clicks
    }

    setSelectedCell({ row: rowIndex, col: columnIndex });
    clearError();

    try {
      const txHash = await placeBet({
        rowIndex,
        columnIndex,
        stakeAmount,
      });

      // Success feedback
      console.log("Bet placed! TX:", txHash);
      if (onBetPlaced) {
        onBetPlaced(txHash);
      }

      // Clear selection after successful bet
      setTimeout(() => setSelectedCell(null), 2000);
    } catch (err) {
      console.error("Failed to place bet:", err);
      // Error is already set by the hook
    }
  };

  /**
   * Get the state of a specific cell
   */
  const getCellState = (rowIndex: number, columnIndex: number): CellState => {
    // Determine if this column is locked
    // columnIndex 0 = earliest bettable bucket
    // Locked means it's before the earliest bettable bucket
    const isLocked = columnIndex < 0;
    
    // Current column is at index -lockedColumnsAhead - 1
    const isCurrent = columnIndex === -(MARKET_CONFIG.lockedColumnsAhead + 1);

    const multiplier = calculateMultiplier(rowIndex, columnIndex);

    return {
      rowIndex,
      columnIndex,
      isLocked,
      isCurrent,
      multiplier,
    };
  };

  /**
   * Render a single grid cell
   */
  const renderCell = (rowIndex: number, columnIndex: number) => {
    const cellState = getCellState(rowIndex, columnIndex);
    const isSelected = selectedCell?.row === rowIndex && selectedCell?.col === columnIndex;

    // Determine cell styling based on state
    let cellClasses = "relative border border-gray-700 p-2 text-center cursor-pointer transition-all ";
    
    if (cellState.isLocked) {
      cellClasses += "bg-gray-800 opacity-50 cursor-not-allowed ";
    } else if (isSelected) {
      cellClasses += "bg-blue-600 ring-2 ring-blue-400 ";
    } else if (cellState.isCurrent) {
      cellClasses += "bg-yellow-900 hover:bg-yellow-800 ";
    } else {
      // Color based on multiplier (higher = more green/attractive)
      const hue = Math.min(120, 60 + cellState.multiplier * 10); // 60-120 = yellow to green
      cellClasses += `hover:ring-2 hover:ring-white `;
      cellClasses += `bg-opacity-30 `;
    }

    return (
      <div
        key={`${rowIndex}-${columnIndex}`}
        className={cellClasses}
        onClick={() => !cellState.isLocked && handleCellClick(rowIndex, columnIndex)}
        style={{
          minWidth: "80px",
          minHeight: "60px",
          backgroundColor: cellState.isLocked 
            ? undefined 
            : `hsla(${Math.min(120, 60 + cellState.multiplier * 10)}, 60%, 30%, 0.3)`,
        }}
      >
        {!cellState.isLocked && (
          <>
            <div className="text-xs font-bold text-white">
              {cellState.multiplier.toFixed(2)}x
            </div>
            {cellState.isCurrent && (
              <div className="text-[10px] text-yellow-300 mt-1">CURRENT</div>
            )}
          </>
        )}
        {cellState.isLocked && (
          <div className="text-xs text-gray-500">🔒</div>
        )}
      </div>
    );
  };

  /**
   * Render column headers (time buckets)
   */
  const renderColumnHeader = (columnIndex: number) => {
    const bucketTimestamp = earliestBettableBucket + columnIndex;
    const timeLabel = `+${columnIndex * MARKET_CONFIG.timeBucketSeconds}s`;
    
    return (
      <div key={`header-${columnIndex}`} className="text-xs text-gray-400 text-center p-2">
        <div className="font-semibold">{timeLabel}</div>
        <div className="text-[10px] text-gray-500">T{bucketTimestamp}</div>
      </div>
    );
  };

  /**
   * Render row headers (price buckets)
   */
  const renderRowHeader = (rowIndex: number) => {
    // Show which is the mid price bucket
    const isMid = rowIndex === MARKET_CONFIG.midPriceBucket;
    const offset = rowIndex - MARKET_CONFIG.midPriceBucket;
    const label = isMid ? "MID" : offset > 0 ? `+${offset}` : `${offset}`;
    
    return (
      <div
        key={`row-${rowIndex}`}
        className={`text-xs p-2 text-center ${isMid ? "bg-purple-900 font-bold" : "bg-gray-800"}`}
      >
        <div className="text-white">{label}</div>
        <div className="text-[10px] text-gray-400">B{rowIndex}</div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">Tap Trading Grid</h2>
        <p className="text-gray-400 text-sm">
          Click a cell to place a bet. Higher multipliers = more risk, more reward.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-4 bg-gray-800 p-4 rounded-lg">
        <div className="flex gap-4 items-center flex-wrap">
          <div>
            <label className="text-sm text-gray-300 block mb-1">Stake Amount</label>
            <input
              type="number"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              className="bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="Amount in coin units"
              min={MARKET_CONFIG.minBetSize}
              max={MARKET_CONFIG.maxBetSize}
            />
            <div className="text-xs text-gray-500 mt-1">
              Min: {MARKET_CONFIG.minBetSize} | Max: {MARKET_CONFIG.maxBetSize}
            </div>
          </div>

          <div>
            <div className="text-sm text-gray-300 mb-1">Wallet Status</div>
            <div className="text-sm">
              {account ? (
                <span className="text-green-400">✓ Connected</span>
              ) : (
                <span className="text-red-400">✗ Not connected</span>
              )}
            </div>
          </div>

          {isPlacing && (
            <div className="text-yellow-400 flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-yellow-400 border-t-transparent"></div>
              <span className="text-sm">Placing bet...</span>
            </div>
          )}
        </div>

        {/* Error display */}
        {error && (
          <div className="mt-3 p-3 bg-red-900 bg-opacity-30 border border-red-700 rounded text-red-300 text-sm">
            <div className="flex items-start gap-2">
              <span>⚠️</span>
              <div>
                <div className="font-semibold">Error</div>
                <div>{error}</div>
              </div>
              <button
                onClick={clearError}
                className="ml-auto text-red-400 hover:text-red-300"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mb-4 flex gap-4 text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-800 opacity-50 border border-gray-700"></div>
          <span>Locked</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-yellow-900 border border-gray-700"></div>
          <span>Current</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-900 bg-opacity-30 border border-gray-700"></div>
          <span>Bettable (green = higher multiplier)</span>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* Column headers */}
          <div className="flex">
            <div className="w-20"></div> {/* Empty corner */}
            {Array.from({ length: UI_CONFIG.visibleFutureColumns }).map((_, colIdx) =>
              renderColumnHeader(colIdx)
            )}
          </div>

          {/* Grid rows */}
          {Array.from({ length: MARKET_CONFIG.numPriceBuckets }).map((_, rowIdx) => {
            // Reverse row order so higher prices are at top
            const rowIndex = MARKET_CONFIG.numPriceBuckets - 1 - rowIdx;
            
            return (
              <div key={`row-${rowIndex}`} className="flex">
                {/* Row header */}
                {renderRowHeader(rowIndex)}
                
                {/* Row cells */}
                {Array.from({ length: UI_CONFIG.visibleFutureColumns }).map((_, colIdx) =>
                  renderCell(rowIndex, colIdx)
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Info footer */}
      <div className="mt-4 text-xs text-gray-500 bg-gray-900 p-3 rounded">
        <div className="grid grid-cols-2 gap-2">
          <div>Time bucket: {MARKET_CONFIG.timeBucketSeconds}s</div>
          <div>Locked columns: {MARKET_CONFIG.lockedColumnsAhead}</div>
          <div>Current bucket: T{currentBucket}</div>
          <div>Earliest bettable: T{earliestBettableBucket}</div>
        </div>
      </div>
    </div>
  );
}
