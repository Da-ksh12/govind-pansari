// Tries an async call again after a short pause — for requests that fail only because the phone's connection hiccuped.
// No React Native / native imports, so tests/unit covers it.

export interface RetryOptions {
  /** Return false for an error that trying again cannot fix (e.g. "not signed in"); it is thrown at once. */
  shouldRetry?: (error: unknown) => boolean;
  /** Replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `attempt`; after a failure waits delaysMs[0] and tries again, then delaysMs[1], and so on — so `[700, 1800]` is up to three tries.
 * The last error is thrown once every try has failed.
 */
export async function retryWithDelays<T>(attempt: () => Promise<T>, delaysMs: readonly number[], options: RetryOptions = {}): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let tried = 0; ; tried++) {
    try {
      return await attempt();
    } catch (error) {
      const delay = delaysMs[tried];
      if (delay === undefined || options.shouldRetry?.(error) === false) throw error;
      await sleep(delay);
    }
  }
}
