import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Aptos, AptosConfig, Network, AccountAuthenticator, SimpleTransaction, Deserializer } from '@aptos-labs/ts-sdk';
import { GasStationClient } from '@shinami/clients/aptos';

dotenv.config();

// Transaction queue to prevent sequence number conflicts
// Maps sender address to a promise chain that ensures sequential processing
const transactionQueues = new Map<string, Promise<any>>();

/**
 * Add a transaction to the sender's queue to ensure sequential processing
 * This prevents multiple transactions from the same sender being processed concurrently
 */
function enqueueTransaction<T>(
  senderAddress: string,
  transactionFn: () => Promise<T>
): Promise<T> {
  const existingQueue = transactionQueues.get(senderAddress) || Promise.resolve();
  
  const newQueue = existingQueue
    .then(() => transactionFn())
    .catch((error) => {
      // Log error but don't break the chain
      console.error(`Transaction failed for ${senderAddress}:`, error.message);
      throw error;
    })
    .finally(() => {
      // Clean up if this was the last transaction
      if (transactionQueues.get(senderAddress) === newQueue) {
        transactionQueues.delete(senderAddress);
      }
    });
  
  transactionQueues.set(senderAddress, newQueue);
  return newQueue;
}

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Movement Aptos client
const config = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: 'https://testnet.movementnetwork.xyz/v1',
});

const movementClient = new Aptos(config);

// Initialize Shinami Gas Station client
const GAS_ACCESS_KEY = process.env.GAS_ACCESS_KEY;
if (!GAS_ACCESS_KEY) {
  throw new Error('GAS_ACCESS_KEY environment variable is required');
}
const gasStation = new GasStationClient(GAS_ACCESS_KEY);

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'TapMove server is running' });
});

/**
 * POST /api/sponsor-transaction
 * 
 * Request body:
 * {
 *   transaction: <serialized transaction object>,
 *   senderAuthenticator: <sender signature object>
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   txHash: string,
 *   transaction: object
 * }
 */
app.post('/api/sponsor-transaction', async (req, res) => {
  try {
    const { transactionBytes, senderAuthenticator } = req.body;

    if (!transactionBytes) {
      return res.status(400).json({
        success: false,
        error: 'Missing transactionBytes in request body',
      });
    }

    if (!senderAuthenticator) {
      return res.status(400).json({
        success: false,
        error: 'Missing senderAuthenticator in request body',
      });
    }

    // Deserialize OUTSIDE the queue to avoid closure issues
    const transaction = SimpleTransaction.deserialize(new Deserializer(new Uint8Array(transactionBytes)));
    const senderAuth = AccountAuthenticator.deserialize(
      new Deserializer(new Uint8Array(senderAuthenticator))
    );
    const senderAddress = transaction.rawTransaction.sender.toString();
    
    console.log('Transaction deserialized:', {
      sender: senderAddress,
      hasRawTransaction: !!transaction.rawTransaction,
      hasBcsToHex: typeof transaction.bcsToHex === 'function',
      hasBcsToBytes: typeof transaction.bcsToBytes === 'function',
    });
    
    console.log('Sponsoring transaction:', { sender: senderAddress });

    // Queue the transaction to prevent concurrent submissions from same sender
    const result = await enqueueTransaction(senderAddress, async () => {
      // Get fee payer signature from Shinami Gas Station
      const feePayerAuthenticator = await gasStation.sponsorTransaction(transaction);

      console.log('Transaction sponsored, submitting...');

      // Retry logic for mempool conflicts
      let lastError: any;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          // Submit the signed transaction with fee payer signature
          const pending = await movementClient.transaction.submit.simple({
            transaction,
            senderAuthenticator: senderAuth,
            feePayerAuthenticator,
          });

          console.log(`Transaction submitted (attempt ${attempt}):`, pending.hash);

          // Return immediately after submission - don't wait for confirmation
          // This makes the frontend feel much faster
          // The transaction will still be confirmed, we just don't block on it
          console.log('Transaction submitted successfully, returning to client...');

          return {
            success: true,
            txHash: pending.hash,
            // Don't wait for transaction - return immediately for speed
          };
        } catch (error: any) {
          lastError = error;
          
          // Check if this is a mempool conflict that might resolve
          if (error.message?.includes('Transaction already in mempool')) {
            console.log(`Mempool conflict on attempt ${attempt}, waiting before retry...`);
            
            // Exponential backoff: 1s, 2s, 4s
            const waitTime = Math.pow(2, attempt - 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            if (attempt === 3) {
              // On final attempt, throw a more helpful error
              throw new Error('Transaction conflict: Please wait a moment and try again. Multiple transactions were submitted too quickly.');
            }
          } else {
            // For other errors, don't retry
            throw error;
          }
        }
      }
      
      throw lastError;
    });

    res.json(result);
  } catch (error: any) {
    console.error('Error sponsoring transaction:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sponsor transaction',
      details: error.toString(),
    });
  }
});

/**
 * POST /api/build-and-sponsor
 * 
 * Higher-level endpoint that builds the transaction on the backend
 * 
 * Request body:
 * {
 *   sender: string,
 *   function: string,
 *   typeArguments: string[],
 *   functionArguments: any[],
 *   senderAuthenticator: <sender signature>
 * }
 */
app.post('/api/build-and-sponsor', async (req, res) => {
  try {
    const { sender, function: functionName, typeArguments, functionArguments, senderAuthenticator } = req.body;

    if (!sender || !functionName || !senderAuthenticator) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sender, function, senderAuthenticator',
      });
    }

    console.log('Building and sponsoring transaction:', {
      sender,
      function: functionName,
      typeArguments,
      functionArguments,
    });

    // Build transaction with fee payer placeholder
    const transaction = await movementClient.transaction.build.simple({
      sender,
      data: {
        function: functionName,
        typeArguments: typeArguments || [],
        functionArguments: functionArguments || [],
      },
      withFeePayer: true,
    });

    console.log('Transaction built, getting sponsorship...');

    // Get fee payer signature from Shinami Gas Station
    const feePayerAuthenticator = await gasStation.sponsorTransaction(transaction);

    console.log('Transaction sponsored, submitting...');

    // Deserialize the sender authenticator
    const senderAuth = AccountAuthenticator.deserialize(
      new Uint8Array(Object.values(senderAuthenticator))
    );

    // Submit the signed transaction with fee payer signature
    const pending = await movementClient.transaction.submit.simple({
      transaction,
      senderAuthenticator: senderAuth,
      feePayerAuthenticator,
    });

    console.log('Transaction submitted:', pending.hash);

    // Wait for transaction to be committed
    const committed = await movementClient.transaction.waitForTransaction({
      transactionHash: pending.hash,
    });

    console.log('Transaction committed:', {
      hash: committed.hash,
      success: committed.success,
    });

    res.json({
      success: true,
      txHash: pending.hash,
      transaction: committed,
    });
  } catch (error: any) {
    console.error('Error building and sponsoring transaction:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to build and sponsor transaction',
      details: error.toString(),
    });
  }
});

app.listen(PORT, () => {
  console.log(`TapMove server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Sponsor endpoint: http://localhost:${PORT}/api/sponsor-transaction`);
  console.log(`Build & sponsor endpoint: http://localhost:${PORT}/api/build-and-sponsor`);
});
