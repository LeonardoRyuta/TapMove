/**
 * TradingHeader - Slim floating header for tap trading interface
 */

import { ActivityIcon, WalletIcon } from "lucide-react";

interface TradingHeaderProps {
  isPriceConnected: boolean;
  latestPrice: number | null;
  balance: number | null;
  address: string | null;
  authenticated: boolean;
  ready: boolean;
  onLogin: () => void;
  onLogout: () => Promise<void>;
}

export function TradingHeader({
  isPriceConnected,
  latestPrice,
  balance,
  address,
  authenticated,
  ready,
  onLogin,
  onLogout,
}: TradingHeaderProps) {

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-[#0b1020]/80 backdrop-blur-xl border-b border-purple-500/20">
      <div className="max-w-[2000px] mx-auto px-6 py-3 flex items-center justify-between">
        {/* Left - Logo & Market Info */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xl">T</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">TapMove</h1>
              <p className="text-xs text-purple-400">Movement Testnet</p>
            </div>
          </div>

          {/* Market & Price */}
          <div className="flex items-center gap-4">
            <div className="px-3 py-1.5 bg-purple-900/30 rounded-lg border border-purple-500/30">
              <span className="text-sm font-semibold text-purple-300">ETH/USD</span>
            </div>
            
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-900/20 rounded-lg border border-emerald-500/30">
              <ActivityIcon 
                size={14} 
                className={isPriceConnected ? "text-emerald-400 animate-pulse" : "text-red-400"} 
              />
              <span className="text-xs text-emerald-300 font-mono">
                {latestPrice ? `$${latestPrice.toFixed(2)}` : '--'}
              </span>
            </div>
          </div>
        </div>

        {/* Right - Wallet */}
        <div className="flex items-center gap-4">
          {ready && authenticated ? (
            <>
              {balance !== null && (
                <div className="px-3 py-1.5 bg-purple-900/30 rounded-lg border border-purple-500/30">
                  <span className="text-sm font-mono text-white">{balance.toFixed(2)} MOVE</span>
                </div>
              )}
              <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600/20 to-pink-600/20 rounded-lg border border-purple-500/30">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                <span className="text-sm font-mono text-white hover:cursor-pointer" onClick={() => navigator.clipboard.writeText(address || '')}>
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </div>
              <button
                onClick={onLogout}
                className="px-4 py-2 text-sm text-purple-300 hover:text-white transition-colors"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={onLogin}
              className="px-6 py-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 rounded-lg text-white font-semibold transition-all shadow-lg shadow-purple-500/20"
            >
              <WalletIcon className="inline-block mr-2" size={16} />
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
