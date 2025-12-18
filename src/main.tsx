import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import './index.css'
import App from './App.tsx'

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || '';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'dark',
        },
        loginMethods: ['email', 'google', 'twitter'],
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
)
