// Vitest replacement for the `server-only` package (see vitest.config.ts).
// The real module throws at import time in non-server contexts, which is
// exactly the guard we want in production and exactly what breaks Node tests.
export {};
