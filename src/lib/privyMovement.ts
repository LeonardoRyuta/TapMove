/**
 * Privy Movement wallet utilities
 */

import type { ConnectedWallet } from "@privy-io/react-auth";

// Re-export types for convenience
export type { ConnectedWallet };

/**
 * Get the public key from a connected wallet
 * 
 * @param wallet - Connected wallet instance
 * @returns Public key as string or null if not available
 */
export function getPublicKey(wallet: ConnectedWallet): string | null {
  try {
    // For Aptos/Movement wallets, the public key might be in different locations
    // depending on the wallet implementation
    if ('meta' in wallet && wallet.meta && typeof wallet.meta === 'object') {
      const meta = wallet.meta as unknown as Record<string, unknown>;
      if ('publicKey' in meta && typeof meta.publicKey === 'string') {
        return meta.publicKey;
      }
    }
    
    // Some wallets expose it directly
    if ('publicKey' in wallet && typeof wallet.publicKey === 'string') {
      return wallet.publicKey;
    }
    
    console.warn('[Privy] Could not find public key in wallet object');
    return null;
  } catch (error) {
    console.error('[Privy] Error getting public key:', error);
    return null;
  }
}

/**
 * Format wallet address for display
 * 
 * @param address - Full wallet address
 * @param prefixLength - Number of characters to show at start (default: 6)
 * @param suffixLength - Number of characters to show at end (default: 4)
 * @returns Formatted address like "0x1234...5678"
 */
export function formatWalletAddress(
  address: string,
  prefixLength: number = 6,
  suffixLength: number = 4
): string {
  if (!address || address.length <= prefixLength + suffixLength) {
    return address;
  }
  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}

/**
 * Validate if an address is a valid Aptos address
 * 
 * @param address - Address to validate
 * @returns True if valid Aptos address format
 */
export function isValidAptosAddress(address: string): boolean {
  // Aptos addresses are hex strings, optionally prefixed with 0x
  // They should be 64 characters (without 0x) or 66 characters (with 0x)
  if (!address) return false;
  
  const cleanAddress = address.startsWith('0x') ? address.slice(2) : address;
  
  // Check if it's a valid hex string of correct length
  const hexRegex = /^[0-9a-fA-F]+$/;
  return hexRegex.test(cleanAddress) && cleanAddress.length <= 64;
}
