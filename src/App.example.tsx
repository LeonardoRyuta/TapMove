/**
 * Example App.tsx showing how to integrate TapGrid
 * 
 * This example shows two approaches:
 * 1. With Privy (production)
 * 2. With test account (development)
 */

import './App.css';
import { AppWithPrivy } from './components/PrivyIntegration';

// For production with Privy embedded wallets
function App() {
  return <AppWithPrivy />;
}

export default App;

// ============================================================================
// Alternative: Simple development version without Privy
// ============================================================================

/*
import { useState, useEffect } from 'react';
import { Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';
import { TapGrid } from './components/TapGrid';

function App() {
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    // For development/testing only - load from environment
    const privateKey = import.meta.env.VITE_TEST_PRIVATE_KEY;
    if (privateKey) {
      try {
        const key = new Ed25519PrivateKey(privateKey);
        const acc = Account.fromPrivateKey({ privateKey: key });
        setAccount(acc);
        console.log('Test account loaded:', acc.accountAddress.toString());
      } catch (err) {
        console.error('Failed to load test account:', err);
      }
    }
  }, []);

  return (
    <div className="app-container">
      {account ? (
        <TapGrid
          account={account}
          defaultStakeAmount="1000000"
          onBetPlaced={(txHash) => {
            console.log('Bet placed successfully!', txHash);
            alert(`Bet placed! TX: ${txHash.slice(0, 10)}...`);
          }}
        />
      ) : (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '100vh',
          color: 'white'
        }}>
          <div>
            <h2>No Test Account Configured</h2>
            <p>Set VITE_TEST_PRIVATE_KEY in your .env file</p>
            <p style={{ fontSize: '0.875rem', color: '#999', marginTop: '1rem' }}>
              For production, use Privy integration instead
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
*/
