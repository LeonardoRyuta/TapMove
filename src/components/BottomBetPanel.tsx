/**
 * BottomBetPanel - Floating bet configuration panel
 */

import { useState, useEffect } from "react";
import { AlertCircleIcon } from "lucide-react";

interface BottomBetPanelProps {
  stakeAmount: bigint;
  onStakeChange: (amount: bigint) => void;
  selectedCell: {
    rowIndex: number;
    columnIndex: number;
    multiplier: number;
  } | null;
  isPlacing: boolean;
  minBet: bigint;
  maxBet: bigint;
  balance: number | null;
  timeBucketSeconds: number;
}

export function BottomBetPanel({
  stakeAmount,
  onStakeChange,
  selectedCell,
  isPlacing,
  minBet,
  maxBet,
  balance,
  timeBucketSeconds,
}: BottomBetPanelProps) {
  const [inputValue, setInputValue] = useState(stakeAmount.toString());

  useEffect(() => {
    setInputValue(stakeAmount.toString());
  }, [stakeAmount]);

  const handleInputChange = (value: string) => {
    setInputValue(value);
    const parsed = value.replace(/[^0-9]/g, '');
    if (parsed) {
      onStakeChange(BigInt(parsed));
    }
  };

  const quickPresets = [
    { label: "0.001", value: 100_000n },
    { label: "0.01", value: 1_000_000n },
    { label: "0.1", value: 10_000_000n },
    { label: "Max", value: balance ? BigInt(Math.floor(balance * 100_000_000)) : maxBet },
  ];

  const stakeInMove = Number(stakeAmount) / 100_000_000;
  const minInMove = Number(minBet) / 100_000_000;
  const maxInMove = Number(maxBet) / 100_000_000;

  const potentialWin = selectedCell ? stakeInMove * selectedCell.multiplier : 0;
  const timeOffset = selectedCell ? (selectedCell.columnIndex + 1) * timeBucketSeconds : 0;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <div className="bg-[#0b1020]/95 backdrop-blur-xl rounded-2xl border border-purple-500/30 shadow-2xl shadow-purple-500/10 p-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr,300px] gap-6">
          {/* Left - Stake Controls */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-purple-300 mb-2">
                Stake Amount
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  className="w-full px-4 py-3 bg-purple-900/20 border border-purple-500/30 rounded-lg text-white font-mono focus:outline-none focus:ring-2 focus:ring-pink-500/50 transition-all"
                  placeholder="Enter stake in octas"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 text-sm">
                  octas
                </div>
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="text-purple-400">≈ {stakeInMove.toFixed(6)} MOVE</span>
                <span className="text-purple-500">
                  Min: {minInMove.toFixed(6)} | Max: {maxInMove.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="grid grid-cols-4 gap-2">
              {quickPresets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => onStakeChange(preset.value)}
                  className="px-3 py-2 bg-purple-900/30 hover:bg-purple-800/40 border border-purple-500/30 rounded-lg text-sm font-medium text-purple-200 transition-all"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right - Selection Summary */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-purple-300 mb-3">Selected Cell</div>
            
            {selectedCell ? (
              <div className="space-y-3 p-4 bg-gradient-to-br from-purple-900/40 to-pink-900/20 rounded-xl border border-purple-500/30">
                <div className="flex justify-between">
                  <span className="text-purple-400 text-sm">Price Row:</span>
                  <span className="text-white font-mono text-sm">#{selectedCell.rowIndex}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-purple-400 text-sm">Time:</span>
                  <span className="text-white font-mono text-sm">+{timeOffset}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-purple-400 text-sm">Multiplier:</span>
                  <span className="text-pink-400 font-bold text-lg">{selectedCell.multiplier.toFixed(2)}x</span>
                </div>
                <div className="pt-3 border-t border-purple-500/20">
                  <div className="flex justify-between items-center">
                    <span className="text-purple-400 text-sm">Potential Win:</span>
                    <span className="text-emerald-400 font-bold text-lg">
                      {potentialWin.toFixed(4)} MOVE
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center p-6 bg-purple-900/10 rounded-xl border border-purple-500/20">
                <div className="text-center">
                  <AlertCircleIcon className="mx-auto mb-2 text-purple-500" size={24} />
                  <p className="text-sm text-purple-400">Click a cell to select</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
