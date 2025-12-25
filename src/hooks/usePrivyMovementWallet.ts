/**
 * Privy integration for Movement wallet
 * 
 * This hook wraps Privy's authentication and provides Aptos-compatible signing
 * using Privy's extended-chains API for Movement/Aptos wallets
 */

import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/extended-chains";
import { useSignRawHash } from "@privy-io/react-auth/extended-chains";
import {
  Account,
  AccountAddress,
  Ed25519PublicKey,
  Ed25519Signature,
  AccountAuthenticatorEd25519,
  generateSigningMessageForTransaction,
} from "@aptos-labs/ts-sdk";
import { aptosClient } from "../lib/aptosClient";

export interface PrivyMovementWallet {
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  address: string | null;
  aptosSigner: AptosSigner | null;
  aptosAccount: Account | null;
  balance: number | null;
  refreshBalance: () => Promise<void>;
}

export interface AptosSigner {
  signAndSubmitTransaction: (payload: any) => Promise<{ hash: string }>;
  signTransaction?: (transaction: any) => Promise<Uint8Array>;
}

/**
 * Hook to integrate Privy with Movement/Aptos
 * Uses Privy's extended-chains API to create and manage Aptos wallets
 */
export function usePrivyMovementWallet(): PrivyMovementWallet {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const addressRef = useRef<string | null>(null);
  
  // Store signRawHash in a ref to ensure we always have the latest version
  const signRawHashRef = useRef(signRawHash);
  
  useEffect(() => {
    signRawHashRef.current = signRawHash;
  }, [signRawHash]);

  // Create Movement wallet on authentication if not exists
  useEffect(() => {
    const setupMovementWallet = async () => {
      if (!authenticated || !user || isCreatingWallet) return;

      // Check if user already has an Aptos/Movement wallet
      const moveWallet = user.linkedAccounts?.find(
        (account: any) => account.chainType === 'aptos'
      ) as any;

      if (moveWallet) {
        console.log('Movement wallet exists:', moveWallet.address);
        return;
      }

      // Create a new Aptos/Movement wallet
      console.log('Creating Movement wallet...');
      setIsCreatingWallet(true);
      try {
        const wallet = await createWallet({ chainType: 'aptos' });
        console.log('Movement wallet created:', (wallet as any).address);

        const coinType = "0x1::aptos_coin::AptosCoin";
        const [balanceStr] = await aptosClient.view<[string]>({
          payload: {
            function: "0x1::coin::balance",
            typeArguments: [coinType],
            functionArguments: [(wallet as any).address],
          },
        });
        const balanceNum = parseInt(balanceStr, 10) / 100_000_000;
        setBalance(balanceNum);
      } catch (error) {
        console.error('Error creating Movement wallet:', error);
      } finally {
        setIsCreatingWallet(false);
      }
    };

    setupMovementWallet();
  }, [authenticated, user, createWallet, isCreatingWallet]);

  // Create Aptos signer from Privy wallet
  const { address, aptosSigner, aptosAccount } = useMemo(() => {
    if (!authenticated || !user) {
      return { address: null, aptosSigner: null, aptosAccount: null };
    }

    // Get the Movement wallet from linked accounts
    const moveWallet = user.linkedAccounts?.find(
      (account: any) => account.chainType === 'aptos'
    ) as any;

    if (!moveWallet || !moveWallet.address) {
      console.log('No Movement wallet found yet');
      return { address: null, aptosSigner: null, aptosAccount: null };
    }

    // CRITICAL: Don't create aptosSigner if signRawHash is not available yet
    if (!signRawHash) {
      console.log('signRawHash not available yet, waiting...');
      return { 
        address: moveWallet.address, 
        aptosSigner: null, 
        aptosAccount: null 
      };
    }

    const walletAddress = moveWallet.address;
    const publicKeyHex = moveWallet.publicKey;

    console.log('Movement wallet loaded:', { address: walletAddress, publicKey: publicKeyHex });

    // Helper to convert Uint8Array to hex
    const toHex = (buffer: Uint8Array): string => {
      return Array.from(buffer)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    };

    // Create signer interface that uses Privy's signRawHash
    const aptosSigner: AptosSigner = {
      signAndSubmitTransaction: async (payload: any) => {
        console.log('Signing transaction with Privy wallet:', walletAddress);

        // Check if signRawHash is available
        const currentSignRawHash = signRawHashRef.current;
        if (!currentSignRawHash) {
          throw new Error('Wallet proxy not initialized. Please wait a moment and try again.');
        }

        // Build the transaction
        const rawTxn = await aptosClient.transaction.build.simple({
          sender: walletAddress,
          data: {
            function: payload.function,
            typeArguments: payload.typeArguments || [],
            functionArguments: payload.functionArguments,
          },
        });

        // Generate signing message
        const message = generateSigningMessageForTransaction(rawTxn);

        // Sign with Privy wallet
        const { signature: rawSignature } = await currentSignRawHash({
          address: walletAddress,
          chainType: 'aptos',
          hash: `0x${toHex(message)}`,
        });

        // Clean up public key (remove 0x prefix and any leading bytes)
        let cleanPublicKey = publicKeyHex.startsWith('0x')
          ? publicKeyHex.slice(2)
          : publicKeyHex;

        // If public key is 66 characters (33 bytes), remove the first byte (00 prefix)
        if (cleanPublicKey.length === 66) {
          cleanPublicKey = cleanPublicKey.slice(2);
        }

        // Create authenticator
        const senderAuthenticator = new AccountAuthenticatorEd25519(
          new Ed25519PublicKey(cleanPublicKey),
          new Ed25519Signature(
            rawSignature.startsWith('0x') ? rawSignature.slice(2) : rawSignature
          )
        );

        // Submit the signed transaction
        const committedTxn = await aptosClient.transaction.submit.simple({
          transaction: rawTxn,
          senderAuthenticator,
        });

        console.log('Transaction submitted:', committedTxn.hash);

        // Wait for confirmation
        const executed = await aptosClient.waitForTransaction({
          transactionHash: committedTxn.hash,
        });

        if (!executed.success) {
          throw new Error('Transaction failed');
        }

        return { hash: committedTxn.hash };
      },

      signTransaction: async (transaction: any) => {
        console.log('Signing transaction (without submit) with Privy wallet:', walletAddress);
        
        // Check if signRawHash is available
        const currentSignRawHash = signRawHashRef.current;
        if (!currentSignRawHash) {
          throw new Error('Wallet proxy not initialized. Please wait a moment and try again.');
        }
        
        // Generate signing message from the pre-built transaction
        const message = generateSigningMessageForTransaction(transaction);
        
        // Sign with Privy wallet
        const { signature: rawSignature } = await currentSignRawHash({
          address: walletAddress,
          chainType: 'aptos',
          hash: `0x${toHex(message)}`,
        });
        
        // Clean up public key (remove 0x prefix and any leading bytes)
        let cleanPublicKey = publicKeyHex.startsWith('0x')
          ? publicKeyHex.slice(2)
          : publicKeyHex;
        
        // If public key is 66 characters (33 bytes), remove the first byte (00 prefix)
        if (cleanPublicKey.length === 66) {
          cleanPublicKey = cleanPublicKey.slice(2);
        }
        
        // Create authenticator
        const senderAuthenticator = new AccountAuthenticatorEd25519(
          new Ed25519PublicKey(cleanPublicKey),
          new Ed25519Signature(
            rawSignature.startsWith('0x') ? rawSignature.slice(2) : rawSignature
          )
        );
        
        return senderAuthenticator.bcsToBytes();
      },
    };

    // Create a mock Account object for compatibility (read-only)
    // This allows components to get the address via account.accountAddress
    const mockAccount = {
      accountAddress: AccountAddress.from(walletAddress),
    } as Account;

    return {
      address: walletAddress,
      aptosSigner,
      aptosAccount: mockAccount,
    };
  }, [authenticated, user, signRawHash]);

  // Update addressRef when address changes
  useEffect(() => {
    addressRef.current = address;
  }, [address]);

  // Stable refreshBalance function using useCallback
  const refreshBalance = useCallback(async () => {
    const currentAddress = addressRef.current;
    if (!currentAddress) return;
    
    try {
      const coinType = "0x1::aptos_coin::AptosCoin";
      const [balanceStr] = await aptosClient.view<[string]>({
        payload: {
          function: "0x1::coin::balance",
          typeArguments: [coinType],
          functionArguments: [currentAddress],
        },  
      });
      const balanceNum = parseInt(balanceStr, 10) / 100_000_000;
      setBalance(balanceNum);
    } catch (error) {
      console.error('Error fetching balance:', error);
    }
  }, []);

  // Auto-refresh balance every 5 seconds when authenticated
  useEffect(() => {
    if (!authenticated || !address) return;

    // Initial fetch
    refreshBalance();

    // Set up interval for periodic refresh
    const intervalId = setInterval(() => {
      refreshBalance();
    }, 5000); // 5 seconds

    // Cleanup interval on unmount or when dependencies change
    return () => clearInterval(intervalId);
  }, [authenticated, address, refreshBalance]);

  return {
    ready,
    authenticated,
    login,
    logout,
    address,
    aptosSigner,
    aptosAccount,
    balance,
    refreshBalance,
  };
}

/**
 * TODO: Production implementation with native Privy Aptos support
 * 
 * When Privy adds native Aptos wallet support, update this hook to:
 * 
 * 1. Find the Aptos wallet from Privy:
 *    const { wallets } = useWallets();
 *    const aptosWallet = wallets.find(w => w.walletClientType === 'aptos');
 * 
 * 2. Get the address:
 *    const address = aptosWallet?.address;
 * 
 * 3. Create signer using Privy's signing method:
 *    const aptosSigner = {
 *      signAndSubmitTransaction: async (payload) => {
 *        // Use Privy's method to sign for Aptos
 *        return await aptosWallet.sign(payload);
 *      }
 *    };
 */
