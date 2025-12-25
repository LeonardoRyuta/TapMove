/**
 * Client for interacting with the TapMove sponsorship server
 */

import type { SimpleTransaction, AccountAuthenticator } from "@aptos-labs/ts-sdk";

const SERVER_URL = import.meta.env.VITE_SPONSOR_SERVER_URL || "http://localhost:3001";

export interface SponsorTransactionRequest {
  transaction: SimpleTransaction;
  senderAuthenticator: AccountAuthenticator;
}

export interface SponsorTransactionResponse {
  success: boolean;
  txHash?: string;
  transaction?: any;
  error?: string;
  details?: string;
}

/**
 * Custom JSON replacer that handles BigInt values
 */
function bigIntReplacer(key: string, value: any): any {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Send a pre-built and signed transaction to the backend for sponsoring
 * 
 * @param transaction - The built transaction object
 * @param senderAuthenticator - The sender's signature
 * @returns Response with transaction hash
 */
export async function sponsorTransaction(
  transaction: SimpleTransaction,
  senderAuthenticator: AccountAuthenticator
): Promise<SponsorTransactionResponse> {
  try {
    // Serialize both the transaction and sender authenticator to bytes
    const transactionBytes = Array.from(transaction.bcsToBytes());
    const senderAuthBytes = Array.from(senderAuthenticator.bcsToBytes());

    const response = await fetch(`${SERVER_URL}/api/sponsor-transaction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transactionBytes,
        senderAuthenticator: senderAuthBytes,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return result;
  } catch (error: any) {
    console.error("Error sponsoring transaction:", error);
    return {
      success: false,
      error: error.message || "Failed to sponsor transaction",
      details: error.toString(),
    };
  }
}

/**
 * Send transaction parameters to backend to build and sponsor
 * 
 * @param params Transaction parameters
 * @returns Response with transaction hash
 */
export async function buildAndSponsorTransaction(params: {
  sender: string;
  function: string;
  typeArguments?: string[];
  functionArguments?: any[];
  senderAuthenticator: AccountAuthenticator;
}): Promise<SponsorTransactionResponse> {
  try {
    // Serialize the sender authenticator to bytes array
    const senderAuthBytes = Array.from(params.senderAuthenticator.bcsToBytes());

    const response = await fetch(`${SERVER_URL}/api/build-and-sponsor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: params.sender,
        function: params.function,
        typeArguments: params.typeArguments || [],
        functionArguments: params.functionArguments || [],
        senderAuthenticator: senderAuthBytes,
      }, bigIntReplacer),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return result;
  } catch (error: any) {
    console.error("Error building and sponsoring transaction:", error);
    return {
      success: false,
      error: error.message || "Failed to build and sponsor transaction",
      details: error.toString(),
    };
  }
}

/**
 * Check if the sponsorship server is available
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();
    return data.status === "ok";
  } catch (error) {
    console.error("Server health check failed:", error);
    return false;
  }
}
