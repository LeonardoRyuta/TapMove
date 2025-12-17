# TapMove Frontend - Quick Reference

## 📦 Installation

```bash
npm install @aptos-labs/ts-sdk @privy-io/react-auth
```

## ⚙️ Configuration (src/aptos/config.ts)

```typescript
export const MARKET_ADMIN_ADDRESS = "0x...";  // Your contract address
export const COIN_TYPE = "0x1::aptos_coin::AptosCoin";
export const MODULE_ADDRESS = "0x...";        // Module address
```

## 🎯 Core API

### Client Functions

```typescript
import * as client from './aptos/tapMarketClient';

// Place a bet
await client.placeBet(account, {
  priceBucket: 5,
  expiryTimestampSecs: 1702800000,
  stakeAmount: "1000000"
});

// Time utilities
const currentBucket = client.getCurrentTimeBucket(10);
const earliestBettable = client.getEarliestBettableBucket(10, 1);
const timestamp = client.columnIndexToTimestamp(5, 10, 1);
```

### React Hook

```typescript
import { useTapMarket } from './hooks/useTapMarket';

const { placeBet, isPlacing, error } = useTapMarket(account);

await placeBet({
  rowIndex: 7,        // Price bucket
  columnIndex: 5,     // Time column
  stakeAmount: "1000000"
});
```

### Grid Component

```typescript
import { TapGrid } from './components/TapGrid';

<TapGrid
  account={aptosAccount}
  defaultStakeAmount="1000000"
  onBetPlaced={(txHash) => console.log(txHash)}
/>
```

## 🔄 Coordinate Conversion

```typescript
// UI → Contract
rowIndex (0-14)          → price_bucket: u8
columnIndex (0-11)       → expiry_timestamp_secs: u64

// Formula
currentBucket = floor(now / timeBucketSeconds)
earliestBucket = currentBucket + lockedColumnsAhead + 1
targetBucket = earliestBucket + columnIndex
expiryTimestamp = targetBucket * timeBucketSeconds
```

## 📊 Multiplier Formula

```typescript
multiplier = 1.05x
  + 0.06x × |row - midRow|
  + 0.08x × columnIndex
  (max 10x)
```

## 🔐 Error Codes

| Code | Constant | Message |
|------|----------|---------|
| 3 | E_INVALID_PRICE_BUCKET | Invalid price bucket |
| 4 | E_BET_TOO_SMALL | Bet too small |
| 5 | E_BET_TOO_LARGE | Bet too large |
| 8 | E_COLUMN_LOCKED | Column is locked |
| 11 | E_TOO_MANY_OPEN_BETS | Too many open bets |

## 🎨 Cell States

| State | Appearance | Clickable |
|-------|------------|-----------|
| Locked | Gray + 🔒 | No |
| Current | Yellow | No |
| Bettable | Green gradient | Yes |
| Selected | Blue ring | - |

## 🚀 Quick Start

```typescript
// 1. Install dependencies
npm install @aptos-labs/ts-sdk @privy-io/react-auth

// 2. Update config
// Edit src/aptos/config.ts with your addresses

// 3. Use in app
import { AppWithPrivy } from './components/PrivyIntegration';
export default AppWithPrivy;

// 4. Run
npm run dev
```

## 📝 Admin Tasks

```bash
# Initialize market
npx ts-node scripts/initMarket.ts

# Set environment
export ADMIN_PRIVATE_KEY=0x...

# Get testnet tokens
curl -X POST https://faucet.testnet.movementlabs.xyz/mint \
  -d '{"address":"YOUR_ADDRESS","amount":100000000}'
```

## 🧪 Testing

```typescript
// Development mode (without Privy)
// Set in .env:
VITE_TEST_PRIVATE_KEY=0x...

// Use test account
const account = createTestAccount(process.env.VITE_TEST_PRIVATE_KEY);
<TapGrid account={account} />
```

## 📂 File Structure

```
src/
├── aptos/
│   ├── config.ts              # Configuration
│   └── tapMarketClient.ts     # SDK client
├── hooks/
│   └── useTapMarket.ts        # React hook
├── components/
│   ├── TapGrid.tsx            # Grid UI
│   └── PrivyIntegration.tsx   # Wallet integration
└── App.tsx                    # Main app
```

## 🔗 Important Links

- **Aptos SDK**: https://aptos.dev/sdks/ts-sdk/
- **Privy**: https://docs.privy.io/
- **Movement**: https://docs.movementlabs.xyz/
- **Pyth**: https://pyth.network/developers/price-feed-ids

## 💡 Common Patterns

### Check Balance Before Bet

```typescript
const hasSufficient = await client.checkSufficientBalance(
  userAddress,
  stakeAmount
);
if (!hasSufficient) {
  alert("Insufficient balance");
}
```

### Calculate Multiplier for Display

```typescript
import { calculateMultiplier } from './hooks/useTapMarket';

const mult = calculateMultiplier(rowIndex, columnIndex);
console.log(`${mult.toFixed(2)}x`); // e.g., "1.35x"
```

### Handle Transaction Success

```typescript
<TapGrid
  onBetPlaced={(txHash) => {
    // Show toast notification
    toast.success(`Bet placed! TX: ${txHash}`);
    
    // Track analytics
    analytics.track('bet_placed', { txHash });
    
    // Refresh user balance
    refetchBalance();
  }}
/>
```

### Custom Stake Input

```typescript
const [stake, setStake] = useState("1000000");

<input
  type="number"
  value={stake}
  onChange={(e) => setStake(e.target.value)}
  min={MARKET_CONFIG.minBetSize}
  max={MARKET_CONFIG.maxBetSize}
/>

<TapGrid defaultStakeAmount={stake} />
```

## ⚠️ Important Notes

- ✅ Never commit private keys
- ✅ Always check balances before tx
- ✅ Validate column is not locked
- ✅ Handle all error cases
- ✅ Use Privy in production
- ❌ Don't export keys from wallets
- ❌ Don't skip error handling
- ❌ Don't hardcode addresses in components

## 🆘 Troubleshooting

```typescript
// Problem: Transaction fails silently
// Solution: Check error in hook
const { error } = useTapMarket(account);
if (error) console.error(error);

// Problem: Wrong timestamp calculation
// Solution: Verify time bucket math
const now = Math.floor(Date.now() / 1000);
const bucket = Math.floor(now / TIME_BUCKET_SECONDS);

// Problem: Balance check fails
// Solution: Ensure coin type is registered
// User must have coin store initialized

// Problem: Privy not working
// Solution: Check Aptos support in Privy dashboard
```

---

For detailed documentation, see `INTEGRATION_GUIDE.md`
