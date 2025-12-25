# TapMove Server

Express server for sponsoring transactions using Shinami Gas Station on Movement testnet.

## Setup

1. Install dependencies:
```bash
cd server
npm install
```

2. Configure environment variables in `.env`:
```
GAS_ACCESS_KEY=your_shinami_gas_access_key
PORT=3001
MODULE_ADDRESS=0x38cf169f63d3a1ff56834ee5b72060e562abf2a10aed65e03680a30d5f745acb
```

3. Run the server:
```bash
npm run dev
```

## Endpoints

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "message": "TapMove server is running"
}
```

### POST /api/sponsor-transaction
Sponsor a pre-built transaction.

**Request body:**
```json
{
  "transaction": "<serialized transaction object>",
  "senderAuthenticator": "<sender signature bytes>"
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "transaction": { ... }
}
```

### POST /api/build-and-sponsor
Build and sponsor a transaction (all in backend).

**Request body:**
```json
{
  "sender": "0x...",
  "function": "0x...::module::function",
  "typeArguments": ["0x1::aptos_coin::AptosCoin"],
  "functionArguments": [arg1, arg2, ...],
  "senderAuthenticator": "<sender signature bytes>"
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "transaction": { ... }
}
```

## Usage with Frontend

### Option 1: Frontend builds transaction, backend sponsors

```typescript
// Frontend (React)
const transaction = await movementClient.transaction.build.simple({
  sender: account.accountAddress,
  data: {
    function: `${MODULE_ADDRESS}::tap_market::place_bet`,
    functionArguments: [marketAdmin, stakeAmount, priceBucket, expiryTimestamp],
  },
  withFeePayer: true,
});

// Sign the transaction
const senderAuthenticator = movementClient.transaction.sign({
  signer: account,
  transaction,
});

// Send to backend for sponsoring
const response = await fetch('http://localhost:3001/api/sponsor-transaction', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    transaction,
    senderAuthenticator: Array.from(senderAuthenticator.bcsToBytes()),
  }),
});

const result = await response.json();
console.log('Transaction hash:', result.txHash);
```

### Option 2: Backend builds and sponsors

```typescript
// Frontend only signs the transaction parameters
const senderAuthenticator = await signTransactionParams({
  sender: account.accountAddress,
  function: `${MODULE_ADDRESS}::tap_market::place_bet`,
  functionArguments: [marketAdmin, stakeAmount, priceBucket, expiryTimestamp],
});

// Backend builds and sponsors
const response = await fetch('http://localhost:3001/api/build-and-sponsor', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sender: account.accountAddress.toString(),
    function: `${MODULE_ADDRESS}::tap_market::place_bet`,
    typeArguments: ['0x1::aptos_coin::AptosCoin'],
    functionArguments: [marketAdmin, stakeAmount, priceBucket, expiryTimestamp],
    senderAuthenticator: Array.from(senderAuthenticator.bcsToBytes()),
  }),
});
```

## Development

- `npm run dev` - Run in development mode with auto-reload
- `npm run build` - Build for production
- `npm start` - Run production build
