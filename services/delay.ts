/** Simulated network latency so loading/skeleton states have something to show. */
export const delay = (ms = 400) => new Promise<void>((resolve) => setTimeout(resolve, ms));
