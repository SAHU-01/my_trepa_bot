/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@trepa/sdk', 'ink', 'ink-spinner'],
};

export default nextConfig;
