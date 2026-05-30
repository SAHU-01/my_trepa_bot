'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { SolanaProviders } from '@privy-io/react-auth/solana';

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID!;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        // Customize Privy's appearance in your app
        appearance: {
          theme: 'dark',
          accentColor: '#10b981', // emerald-500
          logo: 'https://your-logo-url.com',
        },
        // Create embedded wallets for users who don't have a wallet
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        solanaClusters: [{ name: 'mainnet-beta' }],
      }}
    >
      <SolanaProviders>
        {children}
      </SolanaProviders>
    </PrivyProvider>
  );
}
