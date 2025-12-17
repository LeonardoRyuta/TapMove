/**
 * Integration example with Privy embedded wallets
 * 
 * This shows how to:
 * 1. Set up Privy for Aptos/Movement support
 * 2. Get the user's account from Privy
 * 3. Convert Privy wallet to Aptos Account for signing
 * 4. Use with TapGrid component
 */

import React, { useMemo } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { Account, Ed25519PrivateKey, AccountAddress } from "@aptos-labs/ts-sdk";
import { TapGrid } from "./TapGrid";

// ============================================================================
// Privy Configuration
// ============================================================================

const PRIVY_APP_ID = "your-privy-app-id"; // Replace with your Privy app ID

/**
 * Root component with Privy provider
 */
export function AppWithPrivy() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Configure supported chains and wallets
        supportedChains: [
          // Add Movement testnet configuration
          // Privy treats Movement as a custom EVM chain for now
          // You'll need to configure Aptos/Movement support
        ],
        embeddedWallets: {
          createOnLogin: "users-without-wallets", // Auto-create wallet for new users
          requireUserPasswordOnCreate: false, // Passwordless for better UX
        },
      }}
    >
      <AppContent />
    </PrivyProvider>
  );
}

// ============================================================================
// Main App Content
// ============================================================================

function AppContent() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();

  /**
   * Get Aptos account from Privy wallet
   * 
   * NOTE: This is a simplified example. In production, you'll need to:
   * 1. Check if Privy has added native Aptos wallet support
   * 2. Use their Aptos-specific APIs
   * 3. Or use their exportWallet() method to get the private key
   */
  const aptosAccount = useMemo(() => {
    if (!authenticated || !wallets || wallets.length === 0) {
      return null;
    }

    // Find Aptos wallet (if Privy supports it natively)
    const aptosWallet = wallets.find((w) => w.walletClientType === "aptos");
    
    if (!aptosWallet) {
      console.warn("No Aptos wallet found in Privy");
      return null;
    }

    // Get the wallet address
    const address = aptosWallet.address;

    // For signing transactions, you'll need the private key or a signing method
    // This depends on how Privy exposes Aptos signing
    // 
    // Option 1: If Privy provides a signing method directly
    // return createAccountFromPrivyWallet(aptosWallet);
    //
    // Option 2: If you need to export the private key (less secure but sometimes necessary)
    // const privateKey = await aptosWallet.export();
    // return Account.fromPrivateKey({ privateKey });

    // For this example, we'll create a mock account
    // REPLACE THIS with actual Privy integration
    console.warn("Using mock account - replace with actual Privy integration");
    return null;
  }, [authenticated, wallets]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Loading Privy...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header with wallet controls */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Tap Trading</h1>
            <p className="text-sm text-gray-400">Powered by Movement</p>
          </div>

          <div>
            {!authenticated ? (
              <button
                onClick={login}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-sm text-gray-400">Connected</div>
                  <div className="text-sm text-white font-mono">
                    {aptosAccount?.accountAddress.toString().slice(0, 6)}...
                    {aptosAccount?.accountAddress.toString().slice(-4)}
                  </div>
                </div>
                <button
                  onClick={logout}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="py-8">
        {authenticated && aptosAccount ? (
          <TapGrid
            account={aptosAccount}
            defaultStakeAmount="1000000"
            onBetPlaced={(txHash) => {
              console.log("Bet placed! TX:", txHash);
              // Show success toast/notification
              alert(`Bet placed successfully! TX: ${txHash.slice(0, 10)}...`);
            }}
          />
        ) : (
          <div className="max-w-7xl mx-auto px-4">
            <div className="bg-gray-800 rounded-lg p-8 text-center">
              <h2 className="text-xl font-semibold text-white mb-2">
                Connect Your Wallet to Start Trading
              </h2>
              <p className="text-gray-400 mb-6">
                Click "Connect Wallet" to get started with tap trading
              </p>
              {!authenticated && (
                <button
                  onClick={login}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
                >
                  Connect Wallet
                </button>
              )}
              {authenticated && !aptosAccount && (
                <div className="text-yellow-400">
                  <p>Wallet connected but Aptos account not available.</p>
                  <p className="text-sm mt-2">
                    Please ensure Privy is configured for Aptos/Movement support.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ============================================================================
// Alternative: Manual Account Creation (for testing)
// ============================================================================

/**
 * For testing purposes, you can create an account from a private key
 * 
 * WARNING: Never expose private keys in production!
 */
export function createTestAccount(privateKeyHex: string): Account {
  const privateKey = new Ed25519PrivateKey(privateKeyHex);
  return Account.fromPrivateKey({ privateKey });
}

/**
 * Example of using TapGrid with a manually created account (for testing)
 */
export function TapGridTestExample() {
  // In testing, you might have a test account
  // In production, always use wallet providers like Privy
  const testAccount = useMemo(() => {
    // Only for testing - replace with real wallet integration
    const privateKey = process.env.REACT_APP_TEST_PRIVATE_KEY;
    if (!privateKey) return null;
    
    return createTestAccount(privateKey);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 py-8">
      <TapGrid
        account={testAccount}
        defaultStakeAmount="1000000"
        onBetPlaced={(txHash) => {
          console.log("Test bet placed:", txHash);
        }}
      />
    </div>
  );
}
