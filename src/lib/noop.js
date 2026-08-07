/**
 * Empty stand-in for optional modules that are required at runtime but never
 * used here — currently pino-pretty, which WalletConnect's bundled pino tries
 * to load as a dev transport. Webpack aliases it to `false`; Turbopack has no
 * `false` form, so it points here instead.
 */
module.exports = {};
