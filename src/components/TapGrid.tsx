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

import { useState, useEffect } from "react";
import { Account } from "@aptos-labs/ts-sdk";
import { useTapMarket, useGridState, calculateMultiplier } from "../hooks/useTapMarket";
import {
  NUM_PRICE_BUCKETS,
  NUM_VISIBLE_TIME_COLUMNS,
} from "../config/tapMarket";

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

  // Update grid state every second for real-time locked column updates
  useEffect(() => {
    // This effect just ensures the component re-renders periodically
    // so that useGridState reflects current time
    const interval = setInterval(() => {
      // Force a re-render by updating a dummy counter if needed
    }, 1000); // Update every second
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
    const absoluteBucket = currentBucket + columnIndex;
    const isLocked = absoluteBucket < earliestBettableBucket;
    
    // Current column is exactly the current bucket
    const isCurrent = absoluteBucket === currentBucket;

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
    let cellClasses = "relative border border-gray-300 p-2 text-center cursor-pointer transition-all ";
    
    if (cellState.isLocked) {
      cellClasses += "bg-gray-200 opacity-60 cursor-not-allowed ";
    } else if (isSelected) {
      cellClasses += "bg-blue-500 ring-2 ring-blue-400 ";
    } else if (cellState.isCurrent) {
      cellClasses += "bg-yellow-200 hover:bg-yellow-300 ";
    } else {
      // Color based on multiplier (higher = more green/attractive)
      cellClasses += `hover:ring-2 hover:ring-blue-300 `;
      cellClasses += `bg-opacity-40 `;
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
            : `hsla(${Math.min(120, 60 + cellState.multiplier * 10)}, 60%, 75%, 0.5)`,
        }}
      >
        {!cellState.isLocked && (
          <>
            <div className="text-xs font-bold text-gray-800">
              {cellState.multiplier.toFixed(2)}x
            </div>
            {cellState.isCurrent && (
              <div className="text-[10px] text-yellow-700 mt-1 font-semibold">CURRENT</div>
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
    const timeLabel = `+${columnIndex * 10}s`; // TIME_BUCKET_SECONDS = 10
    
    return (
      <div key={`header-${columnIndex}`} className="text-xs text-gray-700 text-center p-2 bg-gray-50">
        <div className="font-semibold">{timeLabel}</div>
        <div className="text-[10px] text-gray-500">T{bucketTimestamp}</div>
      </div>
    );
  };

  /**
   * Render row headers (price buckets)
   */
  const renderRowHeader = (rowIndex: number) => {
    // Show which is the mid price bucket (10 for 21 buckets)
    const midBucket = Math.floor(NUM_PRICE_BUCKETS / 2);
    const isMid = rowIndex === midBucket;
    const offset = rowIndex - midBucket;
    const label = isMid ? "MID" : offset > 0 ? `+${offset}` : `${offset}`;
    
    return (
      <div
        key={`row-${rowIndex}`}
        className={`text-xs p-2 text-center ${isMid ? "bg-purple-200 font-bold" : "bg-gray-100"}`}
      >
        <div className="text-gray-800">{label}</div>
        <div className="text-[10px] text-gray-500">B{rowIndex}</div>
      </div>
    );
  };

  return (
    <div className="w-full mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-xl font-bold text-gray-900 mb-1">Tap Trading Grid</h3>
        <p className="text-gray-600 text-sm">
          Click a cell to place a bet. Higher multipliers = more risk, more reward.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-4 bg-gray-100 p-4 rounded-lg border border-gray-200">
        <div className="flex gap-4 items-center flex-wrap">
          <div>
            <label className="text-sm text-gray-700 block mb-1 font-semibold">Stake Amount</label>
            <input
              type="number"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              className="bg-white text-gray-900 px-3 py-2 rounded border border-gray-300 focus:border-blue-500 focus:outline-none"
              placeholder="Amount in coin units"
            />
            <div className="text-xs text-gray-500 mt-1">
              Min: 100000 | Max: 1000000000
            </div>
          </div>

          <div>
            <div className="text-sm text-gray-700 mb-1 font-semibold">Wallet Status</div>
            <div className="text-sm">
              {account ? (
                <span className="text-green-600">✓ Connected</span>
              ) : (
                <span className="text-red-600">✗ Not connected</span>
              )}
            </div>
          </div>

          {isPlacing && (
            <div className="text-blue-600 flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
              <span className="text-sm">Placing bet...</span>
            </div>
          )}
        </div>

        {/* Error display */}
        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-300 rounded text-red-700 text-sm">
            <div className="flex items-start gap-2">
              <span>⚠️</span>
              <div>
                <div className="font-semibold">Error</div>
                <div>{error}</div>
              </div>
              <button
                onClick={clearError}
                className="ml-auto text-red-600 hover:text-red-700"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mb-4 flex gap-4 text-xs text-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-300 opacity-70 border border-gray-400"></div>
          <span>Locked</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-yellow-200 border border-yellow-400"></div>
          <span>Current</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-200 border border-green-400"></div>
          <span>Bettable (green = higher multiplier)</span>
        </div>
      </div>

      {/* Grid */}
      <div>
        <div className="inline-block min-w-full">
          {/* Column headers */}
          <div className="flex">
            <div className="w-20"></div> {/* Empty corner */}
            {Array.from({ length: NUM_VISIBLE_TIME_COLUMNS }).map((_, colIdx) =>
              renderColumnHeader(colIdx)
            )}
          </div>

          {/* Grid rows */}
          {Array.from({ length: NUM_PRICE_BUCKETS }).map((_, rowIdx) => {
            // Reverse row order so higher prices are at top
            const rowIndex = NUM_PRICE_BUCKETS - 1 - rowIdx;
            
            return (
              <div key={`row-${rowIndex}`} className="flex">
                {/* Row header */}
                {renderRowHeader(rowIndex)}
                
                {/* Row cells */}
                {Array.from({ length: NUM_VISIBLE_TIME_COLUMNS }).map((_, colIdx) =>
                  renderCell(rowIndex, colIdx)
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Info footer */}
      <div className="mt-4 text-xs text-gray-600 bg-gray-50 p-3 rounded border border-gray-200">
        <div className="grid grid-cols-2 gap-2">
          <div>Time bucket: 10s</div>
          <div>Locked columns: 1</div>
          <div>Current bucket: T{currentBucket}</div>
          <div>Earliest bettable: T{earliestBettableBucket}</div>
        </div>
      </div>
    </div>
  );
}
