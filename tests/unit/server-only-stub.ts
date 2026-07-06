// Vitest stand-in for Next's compiler-level `import 'server-only'` marker.
// Next.js enforces the boundary at build time and ships the type declaration
// (no npm package is installed), so under Vitest the bare import would fail to
// resolve. Aliased in vitest.config.ts; intentionally empty.
export {};
