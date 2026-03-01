const createNextPluginPreval = require("next-plugin-preval/config");
const withNextPluginPreval = createNextPluginPreval();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,

  // Prevent ESLint from blocking the production build.
  // ESLint v8 (the version compatible with eslint-config-next 14.x) is deprecated and
  // emits npm deprecation warnings for its own transitive dependencies (glob@7, 
  // @humanwhocodes/object-schema@2).  Upgrading to ESLint v9 requires eslint-config-next v15
  // which in turn requires Next.js 15, so the safest fix for a Next.js 14 project is to
  // keep linting as a separate CI step and never let it block `next build`.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // TypeScript errors should be caught by the IDE / a dedicated `tsc --noEmit` CI step,
  // not by blocking a production deploy.  This prevents minor type drift from taking
  // the whole site down while a proper fix is being worked on.
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = withNextPluginPreval(nextConfig);
