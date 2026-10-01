import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  // Standalone output bundles traced workspace dependencies for the container image.
  output: 'standalone',
  outputFileTracingRoot: resolve(__dirname, '../..'),
};

export default nextConfig;