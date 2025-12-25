/**
 * TapTradingPage - Euphoria-style full-screen trading interface
 */

import { usePrivyMovementWallet } from "../hooks/usePrivyMovementWallet";
import { TradingHeader } from "../components/TradingHeader";
import { PriceCanvas } from "../components/PriceCanvas";

export function TapTradingPage() {
  const { ready, authenticated, login, logout, address, balance } =
    usePrivyMovementWallet();

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
          <h1 className="text-4xl font-bold text-white mb-4">TapMove</h1>
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
        isPriceConnected={true}
        latestPrice={null}
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
          <PriceCanvas />
        </div>
      </div>
    </div>
  );
}
