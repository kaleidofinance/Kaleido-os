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
  async redirects() {
    return [
      // Trade is the front door. Done here rather than with redirect() in a
      // page, because a statically prerendered redirect() ships an HTML body
      // carrying a client-side instruction and no Location header — browsers
      // follow it, crawlers and link previews do not. This emits a real one.
      { source: "/", destination: "/trade", permanent: false },

      // The /v2 prefix is gone. Anything already linked or bookmarked under it
      // still resolves instead of 404ing.
      { source: "/v2", destination: "/trade", permanent: true },
      { source: "/v2/:path*", destination: "/:path*", permanent: true },
    ]
  },

  webpack(config, { dev, isServer }) {
    return config
  },

  experimental: {
    serverComponentsExternalPackages: ["express"],
  },
}

export default nextConfig
