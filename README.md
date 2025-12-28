# TapMove

TapMove is an on-chain prediction market game built on Movement L1 that lets users bet on future cryptocurrency price movements. Players select a price range and time window, placing bets on where they think the price will be when that time expires. The game features gasless transactions, real-time price feeds, and dynamic multipliers based on risk.

## Overview

TapMove transforms price prediction into an interactive grid-based betting experience. Each cell on the grid represents a specific price bucket and time window. Users can place multiple bets simultaneously, with multipliers calculated based on how far the predicted price is from the current price and how soon the bet expires.

The game is built on Movement L1, an Aptos-based Layer 1 blockchain that offers high throughput and low latency. All bets are settled on-chain through smart contracts written in Move, ensuring transparency and trustlessness.

## Features

- **Real-time Price Visualization**: Live ETH/USD price feeds from Pyth Network displayed on an interactive canvas
- **Grid-based Betting**: Intuitive visual interface where each cell represents a betting opportunity
- **Gasless Transactions**: Powered by Shinami Gas Station, users can place bets without paying gas fees
- **Dynamic Multipliers**: Payouts scale based on price distance and time to expiry, rewarding riskier predictions
- **Instant Feedback**: Optimistic UI updates make bet placement feel instantaneous
- **Auto-settlement**: Bets automatically settle when the price enters the predicted cell after expiry
- **Multiple Simultaneous Bets**: Queue system allows rapid placement of multiple bets

## Technology Stack

### Frontend
- **React 18** with TypeScript for type-safe development
- **Vite** as the build tool for fast development and optimized production builds
- **Canvas API** for high-performance price chart rendering
- **Privy** for wallet authentication and transaction signing
- **Aptos TypeScript SDK** for blockchain interactions

### Backend
- **Node.js/Express** server for transaction sponsorship
- **Shinami Gas Station** for gasless transaction support
- **Movement L1 RPC** for blockchain connectivity

### Smart Contracts
- **Move Language** for secure, resource-oriented smart contracts
- **Aptos Framework** for core blockchain functionality
- **Pyth Oracle Integration** for reliable price feeds

### Price Data
- **Pyth Network** via Hermes API for real-time cryptocurrency prices
- **Server-Sent Events (SSE)** for streaming price updates

## Architecture

### Grid System

The betting grid is based on a static coordinate system where each cell has fixed dimensions:

- **Vertical (Price)**: Each cell represents $0.50 increments (configurable via `PRICE_PER_GRID`)
- **Horizontal (Time)**: Each cell represents 5-second intervals (configurable via `TIME_BUCKET_SECONDS`)
- **Price Buckets**: 21 buckets total, with the middle bucket (bucket 10) centered on a reference price
- **Reference Price**: Dynamically calculated and rounded up to the nearest $0.50 increment

When the price updates, the green indicator moves across the grid, but the grid cells themselves remain stationary. This allows bets to maintain their absolute position on the grid.

### Bet Lifecycle

1. **Placement**: User clicks a cell, triggering an optimistic UI update and blockchain transaction
2. **Transaction Processing**: Transaction is built client-side, signed with Privy wallet, sent to server for sponsorship
3. **Sponsorship**: Server obtains fee payer signature from Shinami and submits transaction
4. **Confirmation**: Transaction is submitted to blockchain (server returns immediately without waiting)
5. **Bet ID Extraction**: Background process extracts the on-chain bet ID from transaction events
6. **Settlement Trigger**: After expiry, when current price enters the bet's cell, auto-settlement initiates
7. **Settlement Execution**: On-chain settlement determines win/loss based on where price was at expiry
8. **Result Display**: UI updates with win/loss status and payout amount

### Transaction Flow

```
User Click → Build Transaction → Sign with Privy → Send to Server
                                                          ↓
                                              Get Fee Payer Signature
                                                          ↓
                                              Submit to Blockchain
                                                          ↓
                                              Return Hash Immediately
                                                          ↓
Background: Extract Bet ID → Poll for Confirmation → Update UI
```

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or yarn package manager
- A Privy account (for wallet integration)
- Shinami API key (for gas sponsorship)
- Movement testnet wallet with MOVE tokens

### Installation

1. Clone the repository:
```bash
git clone https://github.com/LeonardoRyuta/TapMove.git
cd TapMove
```

2. Install frontend dependencies:
```bash
npm install
```

3. Install server dependencies:
```bash
cd server
npm install
cd ..
```

4. Configure environment variables:

Create a `.env` file in the root directory:
```env
VITE_PRIVY_APP_ID=your_privy_app_id
VITE_SPONSOR_SERVER_URL=http://localhost:3001
```

Create a `.env` file in the `server` directory:
```env
GAS_ACCESS_KEY=your_shinami_gas_station_key
PORT=3001
```

5. Start the development server:

In one terminal:
```bash
npm run dev
```

In another terminal:
```bash
cd server
npm run dev
```

6. Open your browser to `http://localhost:5173`

## How It Works

### Placing a Bet

1. Log in with your wallet via Privy
2. Observe the real-time price chart and grid overlay
3. Hover over a cell to see the multiplier for that prediction
4. Click a cell to place a bet with your chosen stake amount
5. The bet appears immediately as "pending" then updates to "placed"
6. Multiple bets can be placed rapidly - they're queued and processed sequentially

### Understanding Multipliers

Multipliers are calculated based on two factors:

- **Price Distance**: How far your predicted price bucket is from the current mid-price bucket
- **Time Distance**: How many time buckets ahead your bet expires (closer expiry = higher risk = higher multiplier)

The formula accounts for both risk dimensions, rewarding predictions that are farther from the current price and closer in time.

### Settlement

Bets automatically settle when:

1. The bet's expiry time has passed
2. The current price enters the cell you bet on
3. You're authenticated with your wallet

Settlement can also be triggered manually through the UI. When settled, the smart contract calculates whether you won based on where the price was during your bet's time bucket.

## Known Issues and Future Improvements

### Price to Bucket Conversion Accuracy

The current system uses `Math.floor()` for converting prices to grid buckets, which creates discrete boundaries at exact 50-cent intervals. While this works well for the grid visualization, there are edge cases where rapid price movements near bucket boundaries might cause slight inconsistencies.

**Future improvement**: Implement a more sophisticated bucketing system that accounts for price volatility and provides smoother transitions between buckets.

### Settlement System

Currently, the settlement system triggers when the current price enters a bet's cell after expiry. This is an MVP approach that works but has limitations:

**Current behavior**: A bet settles when the live price crosses into its cell, which might not reflect the exact price at the moment of expiry.

**Ideal solution**: Store historical price data at bucket intervals and settle based on the actual price during the bet's expiry window. This would require:
- On-chain price history storage (expensive)
- Off-chain indexer with price snapshots (more scalable)
- Verifiable price proofs for dispute resolution

### Transaction Speed

While optimizations have been made (immediate server returns, background bet ID extraction, reduced queue delays), there's still room for improvement:

- Transaction confirmation still takes 3-5 seconds on Movement testnet
- Bet ID extraction requires waiting for transaction indexing
- Multiple sequential bets have a 200ms delay between them

**Potential improvements**:
- Batch bet placement in a single transaction
- Pre-compute bet IDs client-side using deterministic generation
- Implement optimistic settlement with on-chain verification

### Grid Hover and Click Alignment

The grid cell highlighting and click detection use snapped coordinates to ensure they align with the visual grid. However, due to floating-point arithmetic, there may be occasional sub-pixel misalignments at certain zoom levels or when panning rapidly.

**Future improvement**: Implement a more robust coordinate system using integer-only arithmetic for grid calculations.

### Auto-settlement Timing

The auto-settlement currently checks for qualifying bets on every price update. This can be resource-intensive if many expired bets exist.

**Potential optimization**: Implement a time-based scheduler that checks for expired bets at regular intervals rather than on every price tick.

## Smart Contract Architecture

The Move smart contracts handle all on-chain logic for bet placement and settlement. Key modules include:

- **tap_market**: Core betting logic, handles bet placement and settlement
- **init_eth_market**: Initialization and configuration for ETH/USD market

Contracts use resource-oriented architecture, ensuring:
- Bets are stored as unique resources
- No double-spending of stakes
- Atomic settlement operations
- Event emission for indexing

## Development Notes

### Code Structure

```
src/
├── components/        # React components
│   ├── PriceCanvas.tsx    # Main grid and betting interface
│   ├── BetsPanel.tsx      # Side panel showing active bets
│   └── ...
├── hooks/            # Custom React hooks
│   ├── useTapMarket.ts    # Blockchain interaction logic
│   ├── usePythPriceStream.ts  # Price feed integration
│   └── usePrivyMovementWallet.ts  # Wallet integration
├── lib/              # Utility libraries
│   ├── aptosClient.ts     # Aptos SDK wrapper
│   ├── sponsorClient.ts   # Server communication
│   └── pythHermesClient.ts  # Pyth API client
└── config/           # Configuration and constants

server/
└── src/
    └── index.ts      # Express server for transaction sponsorship

contracts/
└── sources/
    ├── tap_market.move      # Core betting contract
    └── init_eth_market.move # Market initialization
```

### Testing

The project includes Move unit tests for smart contract logic:

```bash
cd contracts
aptos move test
```

Frontend testing is currently manual. Future work includes:
- Unit tests for utility functions
- Integration tests for blockchain interactions
- E2E tests for user flows

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory, ready for deployment to any static hosting service.

## Acknowledgments

- **Movement Labs** for the high-performance L1 blockchain
- **Pyth Network** for reliable price feeds
- **Shinami** for gas station infrastructure
- **Privy** for seamless wallet authentication
- **Aptos Labs** for the Move language and SDK

## Quick Start

```bash
# Install frontend dependencies
npm install

# Install server dependencies
cd server && npm install && cd ..

# Configure .env files (see Configuration below)

# Start development server (frontend)
npm run dev

# Start sponsorship server (in another terminal)
npm run server
# OR on Windows: start-server.bat
# OR on Linux/Mac: ./start-server.sh
```

## 🚀 New: Gasless Transactions

This project includes a sponsorship server that enables **gasless transactions** using Shinami Gas Station. Users can place bets without needing to pay gas fees!

### Server Setup

1. Navigate to the server directory and install dependencies:
```bash
cd server
npm install
```

2. Configure the server `.env` file:
```env
GAS_ACCESS_KEY=your_shinami_gas_access_key
PORT=3001
MODULE_ADDRESS=0x38cf169f63d3a1ff56834ee5b72060e562abf2a10aed65e03680a30d5f745acb
```

3. Start the server:
```bash
npm run dev
```

See [server/README.md](server/README.md) for detailed documentation.

## Project Structure

```
src/
├── config/tapMarket.ts        # Contract constants & helpers
├── lib/aptosClient.ts         # Aptos SDK wrapper
├── hooks/                     # React hooks
│   ├── usePrivyMovementWallet.ts
│   └── useTapMarket.ts
├── components/                # UI components
│   └── TapGrid.tsx
├── pages/                     # Application pages
│   └── TestTapMarket.tsx
└── App.tsx                    # Main entry
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed documentation.

## Contract

- **Address**: `0x92c1c3e45c1b40d8902e793b73c8712002200318bd12bb3c289da7345110755c`
- **Module**: `tap_market`
- **Network**: Movement L1 (Aptos-based)

## Tech Stack

- React + TypeScript + Vite
- Aptos TypeScript SDK
- Privy (wallet authentication)
- Tailwind CSS

## Development

```bash
npm run dev      # Start dev server
npm run build    # Build for production
npm run lint     # Run ESLint
```
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
