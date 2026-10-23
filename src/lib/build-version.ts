// The build this code came from. next.config.ts inlines NEXT_PUBLIC_BUILD_VERSION into both the
// server and the client bundles of one build, so a POS page whose value differs from the
// heartbeat's is running an older deployment. Local builds are "dev" and never count as new.
export const BUILD_VERSION: string = process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev";
