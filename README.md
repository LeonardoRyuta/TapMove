# TapMove - Tap Trading on Movement L1

A blockchain-based "tap trading" game where users place bets on future price movements in a grid-based interface.

## Quick Start

```bash
# Install dependencies
npm install

# Create .env file with your Privy App ID and test wallet
cp .env.example .env

# Start development server
npm run dev
```

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
