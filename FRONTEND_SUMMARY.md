# TapMove Frontend Implementation - Summary

## ✅ What's Been Created

I've built a complete frontend integration for your TapMove smart contract on Movement testnet. Here's what's included:

### Core Files

1. **`src/aptos/config.ts`**
   - Configuration constants (addresses, coin types, market parameters)
   - Easy to update for different deployments

2. **`src/aptos/tapMarketClient.ts`** 
   - Type-safe Aptos SDK client
   - Functions: `placeBet()`, `initMarket()`, `settleBet()`
   - Helper functions for time bucket calculations
   - Error parsing with user-friendly messages
   - Balance checking

3. **`src/hooks/useTapMarket.ts`**
   - React hook for placing bets
   - Converts UI coordinates → contract parameters
   - Loading states and error handling
   - Multiplier calculation for display
   - Grid state management

4. **`src/components/TapGrid.tsx`**
   - Interactive grid component
   - Color-coded cells by multiplier
   - Locked/current/bettable column states
   - Configurable stake amount
   - Real-time updates
   - Modern Tailwind styling

5. **`src/components/PrivyIntegration.tsx`**
   - Privy embedded wallet integration example
   - Wallet connection UI
   - Account management
   - One-tap transaction flow

6. **`scripts/initMarket.ts`**
   - Admin script to initialize a new market
   - Example configuration
   - Run with: `npx ts-node scripts/initMarket.ts`

7. **`INTEGRATION_GUIDE.md`**
   - Complete documentation
   - API references
   - Examples and best practices
   - Production checklist

## 🎯 How It Works

### User Flow

```
1. User connects wallet (Privy) → Gets Aptos Account
2. User sees grid → 15 rows × 12 columns
3. User taps cell → Selects price bucket + time bucket
4. Hook converts coordinates → price_bucket + expiry_timestamp
5. Client builds transaction → Move function call with type args
6. Wallet signs → Privy handles signing
7. Transaction submitted → Waits for confirmation
8. Success! → Callback with transaction hash
```

### Coordinate System

```typescript
// UI Grid
┌─────┬─────┬─────┬─────┐
│ 14  │ ... │ ... │ ... │  ← Highest price bucket
├─────┼─────┼─────┼─────┤
│  7  │ MID │ ... │ ... │  ← Mid price (current price)
├─────┼─────┼─────┼─────┤
│  0  │ ... │ ... │ ... │  ← Lowest price bucket
└─────┴─────┴─────┴─────┘
  🔒   +0s   +10s  +20s    ← Time buckets

// Maps to contract:
rowIndex     → price_bucket (u8)
columnIndex  → expiry_timestamp_secs (u64)
```

### Key Features

✅ **Type-Safe** - Full TypeScript with Aptos SDK types  
✅ **Error Handling** - Maps Move errors to user messages  
✅ **Validation** - Checks balance, bet size, locked columns  
✅ **Real-Time** - Updates as time advances  
✅ **One-Tap UX** - Minimal friction with embedded wallets  
✅ **Multiplier Display** - Shows risk/reward for each cell  
✅ **Responsive** - Modern UI with Tailwind CSS  

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install @aptos-labs/ts-sdk @privy-io/react-auth
```

### 2. Update Configuration

Edit `src/aptos/config.ts`:

```typescript
export const MARKET_ADMIN_ADDRESS = "0xYOUR_ADDRESS_HERE";
export const MODULE_ADDRESS = "0xYOUR_MODULE_ADDRESS_HERE";
export const COIN_TYPE = "0x1::aptos_coin::AptosCoin";
```

### 3. Set Up Privy

1. Sign up at [privy.io](https://privy.io)
2. Get your App ID
3. Update `PRIVY_APP_ID` in `src/components/PrivyIntegration.tsx`
4. Configure Aptos support in Privy dashboard

### 4. Run Development Server

```bash
npm run dev
```

### 5. Deploy Your App

```bash
npm run build
```

## 📝 Usage Examples

### Basic Integration

```typescript
import { TapGrid } from './components/TapGrid';
import { Account } from '@aptos-labs/ts-sdk';

function MyApp({ account }: { account: Account }) {
  return (
    <TapGrid
      account={account}
      defaultStakeAmount="1000000"
      onBetPlaced={(txHash) => {
        console.log('Success!', txHash);
      }}
    />
  );
}
```

### Using the Hook Directly

```typescript
import { useTapMarket } from './hooks/useTapMarket';

function CustomComponent({ account }) {
  const { placeBet, isPlacing, error } = useTapMarket(account);
  
  const handleBet = async () => {
    try {
      const txHash = await placeBet({
        rowIndex: 7,        // Mid price bucket
        columnIndex: 5,     // 5th column (50 seconds out)
        stakeAmount: "1000000",
      });
      console.log('Bet placed:', txHash);
    } catch (err) {
      console.error('Failed:', error);
    }
  };
  
  return (
    <button onClick={handleBet} disabled={isPlacing}>
      {isPlacing ? 'Placing...' : 'Place Bet'}
    </button>
  );
}
```

### Admin: Initialize Market

```typescript
import { initMarket } from './aptos/tapMarketClient';

const txHash = await initMarket(adminAccount, {
  numPriceBuckets: 15,
  midPriceBucket: 7,
  timeBucketSeconds: 10,
  // ... other config
});
```

## 🔧 Contract Function Mappings

| Frontend Function | Move Function | Description |
|------------------|---------------|-------------|
| `placeBet()` | `place_bet<CoinType>` | User places a bet |
| `initMarket()` | `init_market<CoinType>` | Admin initializes market |
| `settleBet()` | `settle_bet<CoinType>` | Admin settles with Pyth data |

## 🎨 UI Components

### TapGrid Props

```typescript
interface TapGridProps {
  account: Account | null;           // Wallet account
  defaultStakeAmount?: string;       // Default bet size
  onBetPlaced?: (txHash: string) => void;  // Success callback
}
```

### Cell States

- 🟢 **Green** - Bettable cell (darker = higher multiplier)
- 🟡 **Yellow** - Current time column
- ⚫ **Gray + 🔒** - Locked column (cannot bet)
- 🔵 **Blue ring** - Selected cell (while placing bet)

## 🔐 Security Notes

- ✅ Never hardcode private keys in code
- ✅ Use environment variables for sensitive data
- ✅ Always use wallet providers (Privy) in production
- ✅ Validate all user inputs
- ✅ Check balances before transactions
- ✅ Handle errors gracefully

## 📊 Next Steps

### Immediate
1. ✅ Update config with your contract address
2. ✅ Set up Privy account
3. ✅ Test with Movement testnet

### Short-term
- Add bet history display
- Implement settlement monitoring
- Add real-time price chart
- Build backend for auto-settlement

### Long-term
- Add view functions to contract
- Implement event indexing
- Build analytics dashboard
- Mobile app version

## 🐛 Troubleshooting

### "Cannot find module '@aptos-labs/ts-sdk'"
```bash
npm install @aptos-labs/ts-sdk
```

### "Wallet not connected"
- Check Privy configuration
- Ensure user is logged in
- Verify Aptos wallet is available

### "Insufficient balance"
- Get testnet tokens from faucet
- Check coin type matches market

### "Column locked"
- User tried to bet too soon
- Choose a column further in the future

### Transaction fails
- Check error message in console
- Verify contract is deployed
- Ensure sufficient gas/coins

## 📚 Resources

- [Aptos TypeScript SDK](https://aptos.dev/sdks/ts-sdk/)
- [Privy Documentation](https://docs.privy.io/)
- [Movement Labs](https://docs.movementlabs.xyz/)
- [Pyth Network](https://pyth.network/)

## 💬 Support

For questions or issues:
1. Check `INTEGRATION_GUIDE.md` for detailed docs
2. Review example code in components
3. Test with the included admin script
4. Verify contract is deployed correctly

---

**Built with ❤️ for TapMove on Movement**
