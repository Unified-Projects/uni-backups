import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@uni-backups/ui", "@uni-backups/shared"],
};

export default nextConfig;
