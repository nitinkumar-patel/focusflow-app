import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Version disclosure (round-6 REVIEW Nit) — drops the X-Powered-By header.
  poweredByHeader: false,
};

export default nextConfig;
