// ============================================================
// BetsPanel - Display and Manage Bets
// ============================================================

import React from "react";
import { useTapMarket } from "../hooks/useTapMarket";
import { octasToMove } from "../lib/aptosClient";
import type { Bet, BetStatus } from "../types";
import { PYTH_PRICE_IDS } from "../lib/pythHermesClient";

interface BetsPanelProps {
  bets: Bet[];
  clearBets: () => void;
  walletAddress: string | null;
  walletSigner?: { signAndSubmitTransaction: (payload: unknown) => Promise<{ hash: string }> } | null;
}

function getBetStatusColor(status: BetStatus): string {
  switch (status) {
    case "draft":
    case "submitting":
      return "text-yellow-400 bg-yellow-400/10 border-yellow-400/30";
    case "placed":
    case "settle_ready":
      return "text-blue-400 bg-blue-400/10 border-blue-400/30";
    case "placed_missing_id":
      return "text-orange-400 bg-orange-400/10 border-orange-400/30";
    case "settling":
      return "text-purple-400 bg-purple-400/10 border-purple-400/30";
    case "won":
      return "text-green-400 bg-green-400/10 border-green-400/30";
    case "lost":
      return "text-red-400 bg-red-400/10 border-red-400/30";
    case "failed":
      return "text-gray-400 bg-gray-400/10 border-gray-400/30";
    default:
      return "text-gray-400 bg-gray-400/10 border-gray-400/30";
  }
}

function getBetStatusLabel(status: BetStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "submitting":
      return "Submitting...";
    case "placed":
      return "Placed";
    case "placed_missing_id":
      return "Missing ID";
    case "settle_ready":
      return "Ready to Settle";
    case "settling":
      return "Settling...";
    case "won":
      return "Won ✓";
    case "lost":
      return "Lost";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function BetCard({ bet, walletAddress, walletSigner }: { bet: Bet; walletAddress: string | null; walletSigner?: { signAndSubmitTransaction: (payload: unknown) => Promise<{ hash: string }> } | null }) {
  const { settleBet } = useTapMarket(walletAddress, walletSigner);
  const expiryDate = new Date(bet.expiryTimestampSecs * 1000);
  
  // Calculate if settlement is ready (could be in a useState/useEffect for real-time updates)
  const [canSettle, setCanSettle] = React.useState(false);
  
  React.useEffect(() => {
    const checkSettlement = () => {
      const nowSec = Math.floor(Date.now() / 1000);
      setCanSettle(bet.status === "placed" && !!bet.betId && nowSec >= bet.expiryTimestampSecs + 10);
    };
    
    checkSettlement();
    const interval = setInterval(checkSettlement, 1000);
    return () => clearInterval(interval);
  }, [bet.status, bet.betId, bet.expiryTimestampSecs]);

  const handleSettle = async () => {
    if (!bet.betId) return;
    try {
      await settleBet({
        betId: bet.betId,
        priceId: bet.priceId || PYTH_PRICE_IDS.ETH_USD, // Use stored price ID or default to ETH/USD
      });
    } catch (error) {
      console.error('Failed to settle bet:', error);
    }
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 space-y-3">
      {/* Status Badge */}
      <div className="flex items-center justify-between">
        <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${getBetStatusColor(bet.status)}`}>
          {getBetStatusLabel(bet.status)}
        </span>
        {bet.betId && (
          <span className="text-xs text-gray-500 font-mono">ID: {bet.betId.toString().slice(0, 8)}...</span>
        )}
      </div>

      {/* Bet Details */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-gray-400 text-xs mb-1">Price Bucket</div>
          <div className="text-white font-semibold">{bet.priceBucket}</div>
        </div>
        <div>
          <div className="text-gray-400 text-xs mb-1">Stake</div>
          <div className="text-cyan-400 font-semibold">{octasToMove(bet.stakeOctas).toFixed(4)} MOVE</div>
        </div>
        <div className="col-span-2">
          <div className="text-gray-400 text-xs mb-1">Expiry</div>
          <div className="text-white text-xs">{expiryDate.toLocaleString()}</div>
        </div>
      </div>

      {/* Error Message */}
      {bet.error && (
        <div className="text-xs text-red-400 bg-red-400/10 p-2 rounded border border-red-400/30">
          {bet.error}
        </div>
      )}

      {/* Settlement Attempts */}
      {bet.settlementAttempts > 0 && (
        <div className="text-xs text-gray-500">
          Settlement attempts: {bet.settlementAttempts}/3
        </div>
      )}

      {/* Manual Settle Button */}
      {canSettle && (
        <button
          onClick={handleSettle}
          className="w-full px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white text-sm font-semibold rounded hover:from-green-600 hover:to-emerald-600 transition-all"
        >
          Settle Now
        </button>
      )}

      {/* Transaction Link */}
      {bet.txHash && (
        <a
          href={`https://explorer.movementlabs.xyz/txn/${bet.txHash}?network=testnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-cyan-400 hover:text-cyan-300 underline text-center"
        >
          View Transaction →
        </a>
      )}
    </div>
  );
}

export function BetsPanel({ bets, clearBets, walletAddress, walletSigner }: BetsPanelProps) {
  const openBets = bets.filter((b: Bet) => !["won", "lost", "failed"].includes(b.status));
  const closedBets = bets.filter((b: Bet) => ["won", "lost", "failed"].includes(b.status));

  return (
    <div className="w-full max-w-md bg-gray-900 border border-cyan-500/30 rounded-lg p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Your Bets</h2>
        {bets.length > 0 && (
          <button
            onClick={clearBets}
            className="text-xs text-gray-400 hover:text-red-400 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Empty State */}
      {bets.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <div className="text-4xl mb-2">📊</div>
          <div className="text-sm">No bets yet. Tap the grid to get started!</div>
        </div>
      )}

      {/* Open Bets */}
      {openBets.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Open ({openBets.length})
          </h3>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {openBets.map((bet: Bet) => (
              <BetCard key={bet.localId} bet={bet} walletAddress={walletAddress} walletSigner={walletSigner} />
            ))}
          </div>
        </div>
      )}

      {/* Closed Bets */}
      {closedBets.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Closed ({closedBets.length})
          </h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {closedBets.map((bet: Bet) => (
              <BetCard key={bet.localId} bet={bet} walletAddress={walletAddress} walletSigner={walletSigner} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
