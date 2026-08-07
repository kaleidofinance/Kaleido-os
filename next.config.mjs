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
    // WalletConnect's bundled pino tries to require the optional 'pino-pretty'
    // transport, which isn't installed. Webpack chases the unresolved import
    // through a deep trace on every compile, adding noise and time. Alias it to
    // false so the resolver short-circuits instead of walking the graph.
    config.resolve.alias = {
      ...config.resolve.alias,
      "pino-pretty": false,
    }
    return config
  },

  experimental: {
    serverComponentsExternalPackages: ["express"],

    // Turbopack ignores the webpack() hook above, so the pino-pretty stub has
    // to be declared here too — otherwise dev warns that webpack is configured
    // and Turbopack isn't. Webpack still needs its own alias for `next build`.
    turbo: {
      resolveAlias: {
        "pino-pretty": "./src/lib/noop.js",
      },
    },

    // These ship huge barrel files — one `import { x } from "pkg"` pulls the
    // whole index into the graph. thirdweb alone accounted for most of the
    // ~17k modules a single route was compiling. This rewrites barrel imports
    // to direct deep imports so only what's used gets walked.
    optimizePackageImports: [
      "thirdweb",
      "@web3icons/react",
      "react-icons",
      "@radix-ui/themes",
    ],
  },
}

export default nextConfig
