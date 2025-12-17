# TapMove - Complete Frontend Integration 🎯

A complete, production-ready frontend integration for the TapMove tap trading smart contract on Movement testnet.

## 📋 What's Included

This integration provides everything you need to connect your React frontend to the TapMove Move smart contract:

### Core Implementation
- ✅ **TypeScript Client** - Type-safe Aptos SDK integration
- ✅ **React Hook** - `useTapMarket` for easy bet placement
- ✅ **TapGrid Component** - Interactive UI with real-time updates
- ✅ **Privy Integration** - Embedded wallet support
- ✅ **Full Type Safety** - Comprehensive TypeScript types
- ✅ **Error Handling** - User-friendly error messages
- ✅ **Balance Validation** - Pre-transaction checks

### Documentation
- 📖 **Integration Guide** - Complete API documentation
- 📖 **Quick Reference** - Cheat sheet for common tasks
- 📖 **Architecture Diagrams** - Visual system overview
- 📖 **Testing Guide** - Comprehensive testing strategies
- 📖 **Example Scripts** - Admin initialization scripts

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install @aptos-labs/ts-sdk @privy-io/react-auth
```

### 2. Configure

Update `src/aptos/config.ts`:

```typescript
export const MARKET_ADMIN_ADDRESS = "0xYOUR_CONTRACT_ADDRESS";
export const MODULE_ADDRESS = "0xYOUR_MODULE_ADDRESS";
export const COIN_TYPE = "0x1::aptos_coin::AptosCoin";
```

### 3. Set Up Privy

1. Create account at [privy.io](https://privy.io)
2. Get your App ID
3. Update `src/components/PrivyIntegration.tsx`

### 4. Run

```bash
npm run dev
```

## 📁 File Structure

```
src/
├── aptos/
│   ├── config.ts                  # Configuration constants
│   └── tapMarketClient.ts         # Aptos SDK client
├── hooks/
│   └── useTapMarket.ts            # React hook for betting
├── components/
│   ├── TapGrid.tsx                # Interactive grid component
│   └── PrivyIntegration.tsx       # Wallet integration
├── types/
│   └── index.ts                   # TypeScript type definitions
└── App.tsx                        # Main application

scripts/
└── initMarket.ts                  # Admin market initialization

docs/
├── INTEGRATION_GUIDE.md           # Detailed integration docs
├── QUICK_REFERENCE.md             # Quick API reference
├── ARCHITECTURE_DIAGRAMS.md       # System diagrams
├── TESTING_GUIDE.md               # Testing strategies
└── FRONTEND_SUMMARY.md            # Implementation summary
```

## 🎮 Usage Examples

### Basic Integration

```typescript
import { TapGrid } from './components/TapGrid';
import { Account } from '@aptos-labs/ts-sdk';

function App({ account }: { account: Account }) {
  return (
    <TapGrid
      account={account}
      defaultStakeAmount="1000000"
      onBetPlaced={(txHash) => {
        console.log('Bet placed!', txHash);
      }}
    />
  );
}
```

### Using the Hook

```typescript
import { useTapMarket } from './hooks/useTapMarket';

function CustomBetButton({ account, row, col }) {
  const { placeBet, isPlacing, error } = useTapMarket(account);
  
  const handleBet = async () => {
    try {
      const txHash = await placeBet({
        rowIndex: row,
        columnIndex: col,
        stakeAmount: "1000000",
      });
      console.log('Success:', txHash);
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

### Direct Client Usage

```typescript
import * as tapMarketClient from './aptos/tapMarketClient';

// Place a bet
const txHash = await tapMarketClient.placeBet(account, {
  priceBucket: 7,
  expiryTimestampSecs: 1702800070,
  stakeAmount: "1000000",
});

// Get current time bucket
const bucket = tapMarketClient.getCurrentTimeBucket(10);

// Check balance
const hasSufficient = await tapMarketClient.checkSufficientBalance(
  userAddress,
  "1000000"
);
```

## 🎯 Key Features

### Type-Safe Contract Integration

All contract functions are wrapped with full TypeScript types:

```typescript
interface PlaceBetArgs {
  priceBucket: number;        // u8
  expiryTimestampSecs: number; // u64
  stakeAmount: string;         // u64 as string
}
```

### Intelligent Coordinate Mapping

UI grid coordinates automatically convert to contract parameters:

```typescript
// User clicks cell at row 7, column 5
placeBet({
  rowIndex: 7,      // → price_bucket: 7
  columnIndex: 5,   // → expiry_timestamp_secs: (calculated)
  stakeAmount: "1000000"
});
```

### Real-Time Grid Updates

Grid automatically updates as time advances:
- Current column shifts forward
- Locked columns update
- New bettable columns appear

### Multiplier Display

Each cell shows its multiplier based on risk:
- Base: 1.05x
- +0.06x per row from center
- +0.08x per column into future
- Capped at 10x

### Error Handling

Clear, user-friendly error messages:

| Contract Error | User Message |
|----------------|--------------|
| E_COLUMN_LOCKED | "This column is locked - choose a future column" |
| E_BET_TOO_SMALL | "Bet amount is too small" |
| INSUFFICIENT_BALANCE | "Insufficient balance to place this bet" |

## 📊 Architecture

### Data Flow

```
User clicks cell
    ↓
TapGrid component
    ↓
useTapMarket hook
    ↓
tapMarketClient
    ↓
Aptos SDK
    ↓
Movement Blockchain
```

### State Management

- **Component State**: UI-specific (selected cell, stake amount)
- **Hook State**: Transaction status, errors
- **Global State**: Current time bucket, grid configuration

## 🔐 Security

- ✅ Private keys never exposed to frontend
- ✅ All transactions signed by wallet provider
- ✅ Balance checked before transaction
- ✅ Input validation on all parameters
- ✅ Error handling for all edge cases

## 🧪 Testing

### Manual Testing

```bash
# Set test account
export VITE_TEST_PRIVATE_KEY=0x...

# Run dev server
npm run dev

# Test in browser
# 1. Connect wallet
# 2. Click a cell
# 3. Confirm transaction
# 4. Verify success
```

### Automated Testing

See `TESTING_GUIDE.md` for comprehensive testing strategies including:
- Unit tests for client functions
- Integration tests for hooks
- E2E tests for full flow
- Performance testing

## 📚 Documentation

| Document | Description |
|----------|-------------|
| **INTEGRATION_GUIDE.md** | Complete API documentation and integration guide |
| **QUICK_REFERENCE.md** | Quick reference card for common tasks |
| **ARCHITECTURE_DIAGRAMS.md** | Visual diagrams of system architecture |
| **TESTING_GUIDE.md** | Comprehensive testing strategies |
| **FRONTEND_SUMMARY.md** | Summary of implementation |

## 🎨 UI Components

### TapGrid

Interactive grid showing price × time buckets:

```typescript
<TapGrid
  account={aptosAccount}
  defaultStakeAmount="1000000"
  onBetPlaced={(txHash) => console.log(txHash)}
/>
```

**Features:**
- 15 price buckets (rows)
- 12 time buckets (columns)
- Color-coded by multiplier
- Locked/current/bettable states
- Real-time updates
- Mobile responsive

### Cell States

- 🟢 **Green** - Bettable (darker = higher multiplier)
- 🟡 **Yellow** - Current time column
- ⚫ **Gray** - Locked column
- 🔵 **Blue** - Selected/placing bet

## 🔧 Admin Functions

### Initialize Market

```bash
# Set admin key
export ADMIN_PRIVATE_KEY=0x...

# Run initialization script
npx ts-node scripts/initMarket.ts
```

### Settle Bets

```typescript
import { settleBet } from './aptos/tapMarketClient';

const txHash = await settleBet(adminAccount, {
  betId: "123",
  pythPriceUpdate: [pythUpdateBytes],
});
```

## 🌐 Deployment

### Build for Production

```bash
npm run build
```

### Environment Variables

```bash
# Production
VITE_PRIVY_APP_ID=your-privy-app-id

# Development (never in production!)
VITE_TEST_PRIVATE_KEY=0x...
```

### Hosting

Deploy the `dist/` folder to:
- Vercel
- Netlify  
- AWS S3 + CloudFront
- IPFS (for decentralized hosting)

## 🐛 Troubleshooting

### "Cannot find module '@aptos-labs/ts-sdk'"
```bash
npm install @aptos-labs/ts-sdk
```

### "Wallet not connected"
- Ensure Privy is configured
- Check user is logged in
- Verify Aptos wallet available

### "Insufficient balance"
- Get testnet tokens from faucet
- Check correct coin type
- Verify amount vs. balance

### "Column locked"
- User tried to bet too soon
- Choose column further in future
- Wait for time to advance

## 📝 Contract Functions

### place_bet

```move
public entry fun place_bet<CoinType>(
    user: &signer,
    market_admin: address,
    stake_amount: u64,
    price_bucket: u8,
    expiry_timestamp_secs: u64,
)
```

Maps to:
```typescript
await placeBet(account, {
  priceBucket: 7,
  expiryTimestampSecs: 1702800070,
  stakeAmount: "1000000"
});
```

## 🎓 Learning Resources

- [Aptos TypeScript SDK](https://aptos.dev/sdks/ts-sdk/)
- [Privy Documentation](https://docs.privy.io/)
- [Movement Labs](https://docs.movementlabs.xyz/)
- [Pyth Network](https://pyth.network/)
- [Move Language](https://move-language.github.io/move/)

## 🤝 Contributing

To extend this integration:

1. Add new features to `tapMarketClient.ts`
2. Create hooks in `hooks/` for React integration
3. Build UI components in `components/`
4. Add types to `types/index.ts`
5. Update documentation

## 📄 License

This integration code is provided as-is for the TapMove project.

## 🆘 Support

For questions or issues:

1. Check documentation in `docs/`
2. Review example code
3. Test with provided scripts
4. Verify contract deployment

## ✅ Production Checklist

Before deploying to production:

- [ ] Update all addresses in config
- [ ] Configure Privy with correct App ID
- [ ] Test all error scenarios
- [ ] Verify balance checks work
- [ ] Test mobile responsiveness
- [ ] Set up error tracking (Sentry)
- [ ] Configure analytics
- [ ] Test wallet connection/disconnection
- [ ] Verify transaction confirmations
- [ ] Test with real testnet tokens
- [ ] Security audit complete
- [ ] Performance testing done
- [ ] Documentation reviewed

## 🎉 Next Steps

1. **Initialize Market** - Run `initMarket.ts` script
2. **Fund House** - Deposit liquidity to house vault
3. **Test Betting** - Place test bets on testnet
4. **Build Backend** - Auto-settlement service
5. **Add Features**:
   - Bet history display
   - Real-time price chart
   - User dashboard
   - Leaderboard
   - Social features

---

**Built with ❤️ for TapMove on Movement**

For detailed implementation guidance, see `INTEGRATION_GUIDE.md`.
