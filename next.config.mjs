/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    '@trepa/sdk',
    'ink',
    'ink-spinner',
    '@solana/kit',
    '@solana-program/memo',
    '@solana-program/system',
    '@solana-program/token'
  ],
  turbopack: {},
};

export default nextConfig;
