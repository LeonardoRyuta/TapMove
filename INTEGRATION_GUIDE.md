# TapMove Frontend Integration

This guide explains how to integrate your React frontend with the TapMove smart contract on Movement testnet.

## Architecture Overview

```
src/
├── aptos/
│   ├── config.ts               # Configuration constants
│   └── tapMarketClient.ts      # Aptos SDK client for contract interaction
├── hooks/
│   └── useTapMarket.ts         # React hook for placing bets
└── components/
    ├── TapGrid.tsx             # Main grid UI component
    └── PrivyIntegration.tsx    # Privy wallet integration example
```

## Setup

### 1. Install Dependencies

```bash
npm install @aptos-labs/ts-sdk @privy-io/react-auth
```

### 2. Configure Environment

Update `src/aptos/config.ts` with your contract details:

```typescript
export const MARKET_ADMIN_ADDRESS = "0x..."; // Your deployed contract admin address
export const COIN_TYPE = "0x1::aptos_coin::AptosCoin"; // Or your custom coin type
export const MODULE_ADDRESS = "0x..."; // Your contract module address
```

### 3. Set Up Privy

1. Sign up at [privy.io](https://privy.io)
2. Create an app and get your App ID
3. Update `PRIVY_APP_ID` in `src/components/PrivyIntegration.tsx`
4. Configure Aptos/Movement support in your Privy dashboard

## Core Components

### 1. `tapMarketClient.ts` - Contract Client

Provides type-safe functions to interact with the Move contract:

```typescript
import * as tapMarketClient from "./aptos/tapMarketClient";

// Place a bet
const txHash = await tapMarketClient.placeBet(account, {
  priceBucket: 5,
  expiryTimestampSecs: 1702800000,
  stakeAmount: "1000000",
});

// Get current time bucket
const currentBucket = tapMarketClient.getCurrentTimeBucket(10);
```

**Key Functions:**
- `placeBet()` - Place a bet on a price bucket at a future time
- `initMarket()` - Initialize a new market (admin only)
- `settleBet()` - Settle a bet with Pyth price data (admin only)
- `getCurrentTimeBucket()` - Get current time bucket index
- `columnIndexToTimestamp()` - Convert UI column to timestamp
- `checkSufficientBalance()` - Verify user has enough coins

### 2. `useTapMarket` Hook

React hook that simplifies betting with automatic UI coordinate conversion:

```typescript
import { useTapMarket } from "./hooks/useTapMarket";

function MyComponent() {
  const { placeBet, isPlacing, error } = useTapMarket(account);
  
  const handleCellClick = async (row: number, col: number) => {
    const txHash = await placeBet({
      rowIndex: row,
      columnIndex: col,
      stakeAmount: "1000000",
    });
    console.log("Bet placed:", txHash);
  };
}
```

**Features:**
- Converts UI coordinates (row/col) to contract parameters
- Validates bet parameters against on-chain limits
- Checks user balance before transaction
- Handles loading states and errors
- Provides multiplier calculation for UI display

### 3. `TapGrid` Component

Interactive grid component where users place bets:

```typescript
import { TapGrid } from "./components/TapGrid";

function App() {
  return (
    <TapGrid
      account={aptosAccount}
      defaultStakeAmount="1000000"
      onBetPlaced={(txHash) => {
        console.log("Success:", txHash);
      }}
    />
  );
}
```

**Features:**
- Visual grid showing price buckets (rows) × time buckets (columns)
- Color-coded multipliers (greener = higher multiplier)
- Locked columns are grayed out and non-clickable
- Real-time updates as time advances
- Configurable stake amount
- Error handling with user-friendly messages

## How It Works

### Coordinate Mapping

The UI uses a grid coordinate system that maps to contract parameters:

```typescript
// UI Coordinates
rowIndex: 0-14        // Price bucket index (0 = lowest, 14 = highest)
columnIndex: 0-11     // Time column index (0 = earliest bettable)

// Contract Parameters
price_bucket: u8      // Same as rowIndex
expiry_timestamp_secs: u64  // Calculated from columnIndex
```

**Calculation:**
```typescript
// Current time bucket
currentBucket = floor(now_seconds / timeBucketSeconds)

// Earliest bettable bucket (accounts for locked columns)
earliestBucket = currentBucket + lockedColumnsAhead + 1

// Target bucket for a column
targetBucket = earliestBucket + columnIndex

// Expiry timestamp (any time within the target bucket)
expiryTimestamp = targetBucket * timeBucketSeconds
```

### Multiplier Calculation

Multipliers are calculated based on risk (client-side display only, actual calculation on-chain):

```typescript
multiplier = 1.05x base
  + 0.06x per row from center
  + 0.08x per column beyond minimum
  (capped at 10x)
```

Examples:
- Center row, first column: 1.05x
- 3 rows from center, first column: 1.23x
- Center row, 5 columns out: 1.45x
- 5 rows from center, 10 columns out: 2.15x

### Transaction Flow

1. **User clicks cell** → `TapGrid` calls `placeBet()`
2. **Hook validates** → Checks balance, bet size, locked columns
3. **Client builds tx** → Creates Move function payload with type args
4. **Wallet signs** → Privy/wallet provider signs transaction
5. **SDK submits** → Transaction sent to Movement testnet
6. **Wait for confirmation** → Hook waits for transaction finality
7. **Success callback** → `onBetPlaced` called with tx hash

## Privy Integration

### Basic Setup

```typescript
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";

function App() {
  return (
    <PrivyProvider appId="your-app-id">
      <YourApp />
    </PrivyProvider>
  );
}

function YourApp() {
  const { login, authenticated, user } = usePrivy();
  
  // Get Aptos account from Privy
  const account = getAptosAccountFromPrivy(user);
  
  return <TapGrid account={account} />;
}
```

### Getting Aptos Account from Privy

Privy provides embedded wallets with support for multiple chains. For Aptos/Movement:

```typescript
import { useWallets } from "@privy-io/react-auth";

function useAptosAccount() {
  const { wallets } = useWallets();
  
  // Find Aptos wallet
  const aptosWallet = wallets.find(w => w.walletClientType === "aptos");
  
  if (!aptosWallet) return null;
  
  // Convert to Aptos SDK Account
  // Privy provides signing methods - consult their docs for Aptos
  return createAccountFromPrivyWallet(aptosWallet);
}
```

**Important Notes:**
- Check Privy's latest documentation for Aptos support
- You may need to use their `exportWallet()` method for private key access
- For production, use Privy's secure signing methods (don't export keys)
- Implement proper error handling for wallet connection issues

### One-Tap UX

With embedded wallets, users can place bets with minimal friction:

```typescript
// No popup on every transaction - Privy handles it seamlessly
const txHash = await placeBet({ rowIndex, columnIndex, stakeAmount });

// Optional: Show a subtle loading indicator
if (isPlacing) {
  return <Spinner />;
}
```

## Error Handling

The client automatically maps Move error codes to user-friendly messages:

| Error Code | Message |
|------------|---------|
| E_INVALID_PRICE_BUCKET (3) | Invalid price bucket selected |
| E_BET_TOO_SMALL (4) | Bet amount is too small |
| E_BET_TOO_LARGE (5) | Bet amount is too large |
| E_COLUMN_LOCKED (8) | This time column is locked |
| E_TOO_MANY_OPEN_BETS (11) | You have too many open bets |
| INSUFFICIENT_BALANCE | Insufficient balance to place this bet |

## Testing

### Local Testing Without Wallet

For development, you can create a test account:

```typescript
import { createTestAccount } from "./components/PrivyIntegration";

const testAccount = createTestAccount(process.env.TEST_PRIVATE_KEY!);

<TapGrid account={testAccount} />
```

**⚠️ Never use this in production!** Always use proper wallet providers.

### Testnet Faucet

Get test tokens for Movement testnet:
```bash
# Get testnet coins (adjust URL to Movement's faucet)
curl -X POST https://faucet.testnet.movementlabs.xyz/mint \
  -H "Content-Type: application/json" \
  -d '{"address":"YOUR_ADDRESS","amount":100000000}'
```

## Admin Functions

### Initializing a Market

```typescript
import { initMarket } from "./aptos/tapMarketClient";

const txHash = await initMarket(adminAccount, {
  numPriceBuckets: 15,
  midPriceBucket: 7,
  timeBucketSeconds: 10,
  maxExpiryBucketsAhead: 100,
  lockedColumnsAhead: 1,
  minBetSize: 100_000,
  maxBetSize: 1_000_000_000,
  maxOpenBetsPerUser: 50,
  anchorPriceMagnitude: "5000000000", // $50 in Pyth format
  anchorPriceNegative: false,
  bucketSizeMagnitude: "100000000", // $1 per bucket
  bucketSizeNegative: false,
  priceFeedId: new Uint8Array([/* Pyth feed ID */]),
  initialHouseLiquidityAmount: "10000000000", // 100 coins
});
```

### Settling Bets

```typescript
import { settleBet } from "./aptos/tapMarketClient";

// Get Pyth price update from Hermes API
const pythUpdate = await fetchPythPriceUpdate();

const txHash = await settleBet(adminAccount, {
  betId: "123",
  pythPriceUpdate: [pythUpdate],
});
```

## Production Checklist

- [ ] Update `MARKET_ADMIN_ADDRESS` with deployed contract address
- [ ] Configure correct `COIN_TYPE` for your market
- [ ] Set up Privy with proper Aptos support
- [ ] Implement proper error boundaries in React
- [ ] Add transaction confirmation toasts/notifications
- [ ] Implement bet history display (requires backend/indexer)
- [ ] Add real-time price chart integration
- [ ] Set up monitoring for failed transactions
- [ ] Implement proper loading states throughout UI
- [ ] Test all error scenarios (insufficient balance, locked columns, etc.)
- [ ] Add analytics tracking for user actions
- [ ] Optimize for mobile devices

## Next Steps

1. **Read Functions**: The current contract only has write functions. Consider adding view functions to query:
   - User's active bets
   - Market state (current price bucket, house liquidity)
   - Historical bet results
   
2. **Backend Service**: Build a backend to:
   - Periodically call `settleBet` for expired bets
   - Fetch Pyth price updates from Hermes API
   - Index bet history for user dashboard
   
3. **Real-time Updates**: Use WebSockets or polling to:
   - Update grid as time advances
   - Show other users' bets (if public)
   - Display settlement results

4. **Enhanced UI**:
   - Add price chart overlay
   - Show user's bet history
   - Display multiplier heatmap
   - Implement bet confirmation modal

## Support

For issues with:
- **Move contract**: Check contract errors in Movement explorer
- **Aptos SDK**: See [Aptos TypeScript SDK docs](https://aptos.dev/sdks/ts-sdk/)
- **Privy**: Consult [Privy documentation](https://docs.privy.io/)
- **Movement**: Visit [Movement Labs docs](https://docs.movementlabs.xyz/)
