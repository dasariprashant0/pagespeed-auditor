import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // These ship native binaries or runtime-loaded assets (the Prisma query
  // engine, ioredis's native bindings). Bundling them fails at runtime with
  // unhelpful errors, so keep them external to the server build.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "prisma",
    "ioredis",
    "pg",
    "pino",
    "pino-pretty",
  ],
};

// Enables "use workflow" / "use step" -- see lib/workflows/*.
export default withWorkflow(nextConfig);
