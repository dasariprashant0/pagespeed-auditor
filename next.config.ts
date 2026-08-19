import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These ship native binaries or runtime-loaded assets (the Prisma query
  // engine, BullMQ's Lua scripts). Bundling them fails at runtime with
  // unhelpful errors, so keep them external to the server build.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "prisma",
    "bullmq",
    "ioredis",
    "pg",
    "pino",
    "pino-pretty",
  ],
};

export default nextConfig;
