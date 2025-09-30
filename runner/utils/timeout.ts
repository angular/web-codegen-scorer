export class TimeoutError extends Error {}

/**
 * @throws {TimeoutError} thrown when the action did not complete within the timeout.
 */
export async function callWithTimeout<T>(
  description: string,
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutInMin: number,
): Promise<T> {
  const abortController = new AbortController();
  let timeoutID: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutID = setTimeout(
      () => {
        reject(new TimeoutError(`Timeout exceeded for action: ${description}`));

        // Trigger abort signal to cleanup/kill e.g. processes behind a timeout.
        abortController.abort();
      },
      1000 * 60 * timeoutInMin,
    );
  });

  try {
    return await Promise.race([fn(abortController.signal), timeoutPromise]);
  } finally {
    if (timeoutID !== null) {
      clearTimeout(timeoutID);
    }
  }
}
