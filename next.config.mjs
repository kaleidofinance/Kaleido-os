import TerserPlugin from "terser-webpack-plugin"

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  swcMinify: true,
  productionBrowserSourceMaps: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'assets.coingecko.com',
        port: '',
        pathname: '/coins/images/**',
      },
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        port: '',
        pathname: '/trustwallet/assets/**',
      },
      {
        protocol: 'https',
        hostname: 'abstract.money',
        port: '',
        pathname: '/logo.png',
      },
    ],
  },
  webpack(config, { dev, isServer }) {
    return config
  },

  experimental: {
    serverComponentsExternalPackages: ["express"],
  },
}

export default nextConfig
