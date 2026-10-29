const AUTH_TIMEOUT_MS = 15_000;

/** The request didn't settle in time. It may still be running and may still succeed. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/** Bound a reconnecting request so authentication can recover while offline. */
export async function withAuthTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new TimeoutError("Session verification timed out. Check your connection and sign in again."));
        }, AUTH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}


/** Reject with TimeoutError when `request` has not settled within `ms`. */
export async function withTimeout<T>(request: Promise<T>, ms: number, message = "Timed out"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(message)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
