/**
 * Test Harness Page for TapMarket
 * 
 * This page provides a complete testing interface for the tap trading game:
 * - Login/logout controls
 * - Stake input
 * - TapGrid display
 * - Current time and configuration info
 */

import React, { useState, useEffect } from "react";
import { usePrivyMovementWallet } from "../hooks/usePrivyMovementWallet";
import { TapGrid } from "../components/TapGrid";
import {
    NUM_PRICE_BUCKETS,
    NUM_VISIBLE_TIME_COLUMNS,
    TIME_BUCKET_SECONDS,
    MIN_BET_SIZE,
    MAX_BET_SIZE,
    getCurrentBucket,
    getFirstBettableBucket,
} from "../config/tapMarket";

const DEFAULT_STAKE = 1_000_000n; // 0.00001 MOVE (in octas)

export function TestTapMarket() {
    const { ready, authenticated, login, logout, address, aptosAccount } =
        usePrivyMovementWallet();

    const [stake, setStake] = useState<bigint>(DEFAULT_STAKE);
    const [stakeInput, setStakeInput] = useState<string>(DEFAULT_STAKE.toString());
    const [currentTime, setCurrentTime] = useState(Date.now());
    const [lastBetTxHash, setLastBetTxHash] = useState<string | null>(null);

    //log authentication status
    useEffect(() => {
        console.log("Privy Movement Wallet - ready:", ready, "authenticated:", authenticated);
    }, [ready, authenticated]);

    // Update current time every second
    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    /**
     * Handle stake input change
     */
    const handleStakeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setStakeInput(value);

        try {
            const parsed = BigInt(value);
            if (parsed >= MIN_BET_SIZE && parsed <= MAX_BET_SIZE) {
                setStake(parsed);
            }
        } catch (err) {
            console.error("Invalid stake input:", err);
        }
    };

    /**
     * Callback when a bet is placed
     */
    const handleBetPlaced = (txHash: string) => {
        console.log("Bet placed! TX hash:", txHash);
        setLastBetTxHash(txHash);
    };

    // Calculate current time info
    const currentTimestamp = Math.floor(currentTime / 1000);
    const currentBucket = getCurrentBucket();
    const firstBettableBucket = getFirstBettableBucket();

    return (
        <div className="test-tap-market p-8 max-w-6xl mx-auto">
            <header className="mb-8">
                <h1 className="text-4xl font-bold mb-2">TapMarket Test Harness</h1>
                <p className="text-gray-600">
                    Test the tap trading game on Movement blockchain
                </p>
            </header>

            {/* Wallet Section */}
            <section className="wallet-section mb-8 p-6 bg-white rounded-lg shadow">
                <h2 className="text-2xl font-bold mb-4">Wallet</h2>

                {!ready && <p className="text-gray-500">Loading Privy...</p>}

                {ready && !authenticated && (
                    <div>
                        <p className="mb-4 text-gray-700">Connect your wallet to start betting</p>
                        <button
                            onClick={login}
                            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                        >
                            Login with Privy
                        </button>
                    </div>
                )}

                {ready && authenticated && (
                    <div>
                        <p className="mb-2">
                            <strong>Address:</strong>{" "}
                            <span className="font-mono text-sm">{address || "N/A"}</span>
                        </p>
                        <p className="mb-4">
                            <strong>Status:</strong>{" "}
                            <span className="text-green-600">Connected</span>
                        </p>
                        <button
                            onClick={logout}
                            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                        >
                            Logout
                        </button>
                    </div>
                )}
            </section>

            {/* Stake Input Section */}
            <section className="stake-section mb-8 p-6 bg-white rounded-lg shadow">
                <h2 className="text-2xl font-bold mb-4">Bet Configuration</h2>

                <div className="mb-4">
                    <label htmlFor="stake-input" className="block font-semibold mb-2">
                        Stake Amount (octas):
                    </label>
                    <input
                        id="stake-input"
                        type="text"
                        value={stakeInput}
                        onChange={handleStakeChange}
                        className="w-full px-4 py-2 border rounded-lg"
                        placeholder="Enter stake in octas"
                    />
                    <p className="text-sm text-gray-600 mt-1">
                        Min: {MIN_BET_SIZE.toString()} | Max: {MAX_BET_SIZE.toString()}
                    </p>
                    <p className="text-sm text-gray-600">
                        Current: {stake.toString()} octas (≈ {(Number(stake) / 100_000_000).toFixed(4)} MOVE)
                    </p>
                </div>

                {lastBetTxHash && (
                    <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded">
                        <p className="text-sm">
                            <strong>Last Bet TX:</strong>{" "}
                            <span className="font-mono text-xs break-all">{lastBetTxHash}</span>
                        </p>
                    </div>
                )}
            </section>

            {/* TapGrid Section */}
            <section className="grid-section mb-8 p-6 bg-white rounded-lg shadow">
                <h2 className="text-2xl font-bold mb-4">Tap Grid</h2>

                {authenticated && aptosAccount ? (
                    <TapGrid
                        account={aptosAccount}
                        defaultStakeAmount={stake.toString()}
                        onBetPlaced={handleBetPlaced}
                    />
                ) : (
                    <div className="text-center py-12 text-gray-500">
                        <p>Please connect your wallet to see the betting grid</p>
                    </div>
                )}
            </section>

            {/* Info Panel */}
            <section className="info-section p-6 bg-gray-50 rounded-lg">
                <h2 className="text-2xl font-bold mb-4">System Info</h2>

                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <p><strong>Current Time:</strong> {new Date(currentTime).toLocaleString()}</p>
                        <p><strong>Current Timestamp:</strong> {currentTimestamp}s</p>
                        <p><strong>Current Time Bucket:</strong> {currentBucket}</p>
                        <p><strong>First Bettable Bucket:</strong> {firstBettableBucket}</p>
                    </div>

                    <div>
                        <p><strong>Price Buckets:</strong> {NUM_PRICE_BUCKETS}</p>
                        <p><strong>Visible Time Columns:</strong> {NUM_VISIBLE_TIME_COLUMNS}</p>
                        <p><strong>Time Bucket Duration:</strong> {TIME_BUCKET_SECONDS}s</p>
                    </div>
                </div>
            </section>
        </div>
    );
}
