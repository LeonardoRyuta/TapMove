# Testing Guide for TapMove Frontend

## Quick Start Testing

### 1. Local Development Testing

```bash
# Install dependencies
npm install

# Set up test environment
cp .env.example .env

# Add test private key (get from Movement faucet)
echo "VITE_TEST_PRIVATE_KEY=0x..." >> .env

# Run dev server
npm run dev
```

### 2. Get Test Tokens

```bash
# Generate a new test account (run in Node.js)
node -e "
  const { Ed25519PrivateKey, Account } = require('@aptos-labs/ts-sdk');
  const key = Ed25519PrivateKey.generate();
  const account = Account.fromPrivateKey({ privateKey: key });
  console.log('Address:', account.accountAddress.toString());
  console.log('Private Key:', key.toString());
"

# Fund with Movement testnet faucet
curl -X POST https://faucet.testnet.movementlabs.xyz/mint \
  -H "Content-Type: application/json" \
  -d '{
    "address": "YOUR_ADDRESS_HERE",
    "amount": 100000000
  }'
```

## Unit Tests (Placeholder Structure)

### Testing tapMarketClient.ts

```typescript
// tests/tapMarketClient.test.ts
import { describe, it, expect } from 'vitest';
import * as client from '../src/aptos/tapMarketClient';

describe('tapMarketClient', () => {
  describe('getCurrentTimeBucket', () => {
    it('should calculate current time bucket correctly', () => {
      const timeBucketSeconds = 10;
      // Mock Date.now() to return a known timestamp
      const mockNow = 1702800055000; // milliseconds
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);
      
      const bucket = client.getCurrentTimeBucket(timeBucketSeconds);
      
      // Expected: floor(1702800055 / 10) = 170280005
      expect(bucket).toBe(170280005);
    });
  });

  describe('getEarliestBettableBucket', () => {
    it('should calculate earliest bettable bucket', () => {
      const timeBucketSeconds = 10;
      const lockedColumnsAhead = 1;
      const mockNow = 1702800000000;
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);
      
      const earliest = client.getEarliestBettableBucket(
        timeBucketSeconds,
        lockedColumnsAhead
      );
      
      // Current: 170280000
      // Earliest: 170280000 + 1 + 1 = 170280002
      expect(earliest).toBe(170280002);
    });
  });

  describe('columnIndexToTimestamp', () => {
    it('should convert column index to timestamp', () => {
      const columnIndex = 5;
      const timeBucketSeconds = 10;
      const lockedColumnsAhead = 1;
      const mockNow = 1702800000000;
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);
      
      const timestamp = client.columnIndexToTimestamp(
        columnIndex,
        timeBucketSeconds,
        lockedColumnsAhead
      );
      
      // Earliest bucket: 170280002
      // Target bucket: 170280002 + 5 = 170280007
      // Timestamp: 170280007 * 10 = 1702800070
      expect(timestamp).toBe(1702800070);
    });
  });
});
```

### Testing useTapMarket Hook

```typescript
// tests/useTapMarket.test.ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTapMarket } from '../src/hooks/useTapMarket';

describe('useTapMarket', () => {
  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useTapMarket(mockAccount));
    
    expect(result.current.isPlacing).toBe(false);
    expect(result.current.error).toBe(null);
    expect(typeof result.current.placeBet).toBe('function');
  });

  it('should validate row index', async () => {
    const { result } = renderHook(() => useTapMarket(mockAccount));
    
    await act(async () => {
      try {
        await result.current.placeBet({
          rowIndex: 99, // Invalid
          columnIndex: 5,
          stakeAmount: "1000000"
        });
      } catch (error) {
        expect(error.message).toContain('Invalid row index');
      }
    });
  });

  it('should validate stake amount', async () => {
    const { result } = renderHook(() => useTapMarket(mockAccount));
    
    await act(async () => {
      try {
        await result.current.placeBet({
          rowIndex: 7,
          columnIndex: 5,
          stakeAmount: "100" // Too small
        });
      } catch (error) {
        expect(error.message).toContain('too small');
      }
    });
  });
});
```

### Testing calculateMultiplier

```typescript
// tests/multiplier.test.ts
import { calculateMultiplier } from '../src/hooks/useTapMarket';

describe('calculateMultiplier', () => {
  it('should calculate base multiplier for center cell', () => {
    const mult = calculateMultiplier(7, 0); // Mid bucket, first column
    expect(mult).toBe(1.05); // 10500 bps = 1.05x
  });

  it('should increase multiplier with row distance', () => {
    const mult1 = calculateMultiplier(7, 0); // Center
    const mult2 = calculateMultiplier(10, 0); // 3 rows up
    
    // Each row adds 600 bps = 0.06x
    expect(mult2).toBe(mult1 + 0.18); // +3 * 0.06
  });

  it('should increase multiplier with column distance', () => {
    const mult1 = calculateMultiplier(7, 0); // First column
    const mult2 = calculateMultiplier(7, 5); // 5 columns out
    
    // Each column adds 800 bps = 0.08x
    expect(mult2).toBe(mult1 + 0.40); // +5 * 0.08
  });

  it('should cap multiplier at 10x', () => {
    const mult = calculateMultiplier(14, 50); // Far corner
    expect(mult).toBeLessThanOrEqual(10.0);
  });
});
```

## Integration Tests

### Testing Full Bet Flow

```typescript
// tests/integration/betFlow.test.ts
import { renderWithProviders } from './testUtils';
import { TapGrid } from '../src/components/TapGrid';
import { fireEvent, waitFor, screen } from '@testing-library/react';

describe('Bet Placement Flow', () => {
  it('should place a bet when cell is clicked', async () => {
    const onBetPlaced = jest.fn();
    const mockAccount = createMockAccount();
    
    renderWithProviders(
      <TapGrid
        account={mockAccount}
        defaultStakeAmount="1000000"
        onBetPlaced={onBetPlaced}
      />
    );
    
    // Find a bettable cell (not locked)
    const cell = screen.getByTestId('cell-7-5');
    
    // Click the cell
    fireEvent.click(cell);
    
    // Wait for transaction to complete
    await waitFor(() => {
      expect(onBetPlaced).toHaveBeenCalledWith(expect.any(String));
    }, { timeout: 10000 });
  });

  it('should show error for locked column', async () => {
    const mockAccount = createMockAccount();
    
    renderWithProviders(
      <TapGrid account={mockAccount} />
    );
    
    // Try to click a locked cell
    const lockedCell = screen.getByTestId('cell-7-0'); // Current column
    fireEvent.click(lockedCell);
    
    // Should show error
    await waitFor(() => {
      expect(screen.getByText(/locked/i)).toBeInTheDocument();
    });
  });
});
```

## Manual Testing Checklist

### Basic Functionality

- [ ] **Grid Rendering**
  - [ ] Grid displays correct number of rows (15)
  - [ ] Grid displays correct number of columns (12)
  - [ ] Multipliers are shown on each cell
  - [ ] Locked columns are grayed out
  - [ ] Current column is highlighted

- [ ] **Wallet Connection**
  - [ ] Connect button works
  - [ ] Wallet address displays correctly
  - [ ] Disconnect button works
  - [ ] Balance updates after transaction

- [ ] **Bet Placement**
  - [ ] Clicking bettable cell opens confirmation
  - [ ] Clicking locked cell shows error
  - [ ] Transaction submits successfully
  - [ ] Loading state shows during transaction
  - [ ] Success message appears on completion
  - [ ] Error message shows on failure

- [ ] **Input Validation**
  - [ ] Stake amount validates min/max
  - [ ] Cannot enter negative stake
  - [ ] Cannot bet with insufficient balance
  - [ ] Cannot bet more than max limit

- [ ] **Real-time Updates**
  - [ ] Current bucket updates every 10 seconds
  - [ ] Locked columns shift as time advances
  - [ ] New columns appear on the right

### Edge Cases

- [ ] **No Wallet Connected**
  - [ ] Shows "Connect Wallet" message
  - [ ] Clicking cells prompts to connect
  - [ ] No crashes when wallet is null

- [ ] **Insufficient Balance**
  - [ ] Shows clear error message
  - [ ] Suggests getting more tokens
  - [ ] Doesn't submit transaction

- [ ] **Network Errors**
  - [ ] Handles RPC timeout gracefully
  - [ ] Shows retry option
  - [ ] Maintains UI state on error

- [ ] **Rapid Clicking**
  - [ ] Prevents double submission
  - [ ] Shows loading state
  - [ ] Queues requests properly

### Visual/UX Testing

- [ ] **Responsive Design**
  - [ ] Works on mobile (320px+)
  - [ ] Works on tablet (768px+)
  - [ ] Works on desktop (1024px+)
  - [ ] Horizontal scroll for grid on small screens

- [ ] **Color Scheme**
  - [ ] Multiplier colors are distinguishable
  - [ ] Locked cells are clearly different
  - [ ] Selected cell is highlighted
  - [ ] Text is readable on all backgrounds

- [ ] **Accessibility**
  - [ ] Keyboard navigation works
  - [ ] Screen reader announces cell states
  - [ ] Focus indicators are visible
  - [ ] Color contrast meets WCAG AA

## Performance Testing

### Load Testing

```typescript
// tests/performance/load.test.ts
describe('Performance', () => {
  it('should render large grid efficiently', async () => {
    const start = performance.now();
    
    renderWithProviders(<TapGrid account={mockAccount} />);
    
    const end = performance.now();
    const renderTime = end - start;
    
    // Should render in under 100ms
    expect(renderTime).toBeLessThan(100);
  });

  it('should handle rapid state updates', async () => {
    const { rerender } = renderWithProviders(<TapGrid account={mockAccount} />);
    
    const start = performance.now();
    
    // Trigger 100 re-renders
    for (let i = 0; i < 100; i++) {
      rerender(<TapGrid account={mockAccount} />);
    }
    
    const end = performance.now();
    
    // Should complete in under 500ms
    expect(end - start).toBeLessThan(500);
  });
});
```

## E2E Testing with Playwright

```typescript
// e2e/betPlacement.spec.ts
import { test, expect } from '@playwright/test';

test('complete bet placement flow', async ({ page }) => {
  // Navigate to app
  await page.goto('http://localhost:5173');
  
  // Connect wallet (assuming test wallet is configured)
  await page.click('button:has-text("Connect Wallet")');
  await page.waitForSelector('text=Connected');
  
  // Set stake amount
  await page.fill('input[type="number"]', '1000000');
  
  // Click a bettable cell
  await page.click('[data-testid="cell-7-5"]');
  
  // Wait for transaction
  await page.waitForSelector('text=Bet placed successfully', {
    timeout: 30000
  });
  
  // Verify success message
  const successMessage = await page.textContent('.success-message');
  expect(successMessage).toContain('TX:');
});
```

## Debugging Tips

### Enable Verbose Logging

```typescript
// Add to config.ts
export const DEBUG = import.meta.env.DEV;

// Use in client
if (DEBUG) {
  console.log('Transaction payload:', payload);
}
```

### Inspect Transactions

```typescript
// Add to tapMarketClient.ts
async function placeBet(account: Account, args: PlaceBetArgs) {
  console.log('=== Placing Bet ===');
  console.log('Account:', account.accountAddress.toString());
  console.log('Args:', args);
  
  const transaction = await aptos.transaction.build.simple({
    // ...
  });
  
  console.log('Transaction:', JSON.stringify(transaction, null, 2));
  
  // Continue with signing...
}
```

### Monitor Network Requests

```typescript
// Add interceptor for API calls
if (import.meta.env.DEV) {
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    console.log('Fetch:', args[0]);
    const response = await originalFetch(...args);
    console.log('Response:', response.status);
    return response;
  };
}
```

## Test Data

### Sample Test Accounts

```typescript
// tests/fixtures/accounts.ts
export const TEST_ACCOUNTS = {
  admin: {
    privateKey: '0x...',
    address: '0x...',
  },
  user1: {
    privateKey: '0x...',
    address: '0x...',
  },
  user2: {
    privateKey: '0x...',
    address: '0x...',
  },
};
```

### Sample Pyth Price Feeds

```typescript
// tests/fixtures/pyth.ts
export const PYTH_FEEDS = {
  BTC_USD: new Uint8Array([
    0xe6, 0x2d, 0xf6, 0xc8, 0xb4, 0xa8, 0x54, 0x97,
    // ... rest of feed ID
  ]),
  ETH_USD: new Uint8Array([
    // ...
  ]),
};
```

## CI/CD Testing

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run type check
        run: npm run type-check
      
      - name: Run unit tests
        run: npm test
      
      - name: Build
        run: npm run build
```

## Production Testing

### Pre-deployment Checklist

- [ ] All tests pass
- [ ] No console errors in production build
- [ ] Bundle size is reasonable (<1MB)
- [ ] Lighthouse score >90
- [ ] Works on target browsers (Chrome, Firefox, Safari)
- [ ] Mobile responsiveness verified
- [ ] Security audit passed
- [ ] Error tracking configured (Sentry, etc.)
- [ ] Analytics configured
- [ ] Wallet provider tested in production

### Monitoring in Production

```typescript
// Add error tracking
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: 'YOUR_SENTRY_DSN',
  environment: import.meta.env.MODE,
});

// Track bet placements
try {
  const txHash = await placeBet(params);
  analytics.track('bet_placed', { txHash, amount: params.stakeAmount });
} catch (error) {
  Sentry.captureException(error);
  analytics.track('bet_failed', { error: error.message });
}
```

---

This testing guide covers all aspects of testing the TapMove frontend. Start with manual testing, then add automated tests as the project matures.
