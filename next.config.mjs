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
      // `/` used to 307 to /trade ("Trade is the front door"). It doesn't any
      // more: src/app/(marketing)/page.tsx serves a real landing page there, so
      // the app now has two front doors — `/` sells and /trade works. Do not
      // reinstate this redirect without deleting that route group; a redirect
      // wins over a page at the same path, so the page would simply stop being
      // reachable with nothing failing to say so.
      //
      // The rest are done here rather than with redirect() in a page, because a
      // statically prerendered redirect() ships an HTML body carrying a
      // client-side instruction and no Location header — browsers follow it,
      // crawlers and link previews do not. These emit real ones.

      // The /v2 prefix is gone. Anything already linked or bookmarked under it
      // still resolves instead of 404ing.
      { source: "/v2", destination: "/trade", permanent: true },
      { source: "/v2/:path*", destination: "/:path*", permanent: true },

      // /explore is retired. Its two tables moved to /pool and its stat strip
      // moved to /leaderboard, so there is no page left to serve. Permanent
      // rather than temporary: the route is not coming back under that name,
      // and a 308 is what tells a crawler to forget it rather than keep
      // requesting it. Points to /leaderboard because that is where the strip
      // and the URL's replacement both live; a visitor after the pool tables
      // has one click from there.
      { source: "/explore", destination: "/leaderboard", permanent: true },
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
    // whole index into the graph. This rewrites barrel imports to direct deep
    // imports so only what's used gets walked.
    //
    // IMPORTANT: entries match the import specifier, not the package. Listing
    // "thirdweb" only covers `from "thirdweb"` — which this codebase does
    // exactly twice. The imports that actually cost anything are the subpaths,
    // and each needs its own entry:
    //
    //   from "thirdweb/react"             48x
    //   from "thirdweb/adapters/ethers6"  20x
    //
    // Measured from .next/trace before adding them: 13,526 modules compiled
    // for one route, of which thirdweb was 7,450 and @web3icons/react 4,360 —
    // 87% of the graph, essentially none of it covered by the old list.
    //
    // @web3icons/react is no longer listed because nothing imports its barrel
    // any more. optimizePackageImports could not have helped there in any
    // case: the cost was `dynamic`'s runtime string lookup over a generated
    // map of ~2,200 `() => import(...)` thunks, which no barrel rewrite can
    // narrow — the bundler has to build every branch. See
    // src/components/v2/ChainIcon.tsx, which imports the 12 icons this app
    // actually draws.
    optimizePackageImports: [
      "thirdweb",
      "thirdweb/react",
      "thirdweb/wallets",
      "thirdweb/chains",
      "thirdweb/adapters/ethers6",
      "react-icons",
      "@radix-ui/themes",
    ],
  },
}

export default nextConfig
