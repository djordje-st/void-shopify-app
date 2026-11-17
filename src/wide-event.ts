import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "void/log";

type Fields = Record<string, unknown>;

const currentEvent = new AsyncLocalStorage<Fields>();

/** Adds fields to the event being built. Outside an event it does nothing. */
export function annotate(fields: Fields) {
  const event = currentEvent.getStore();

  if (event) {
    Object.assign(event, fields);
  }
}

/** Adds to a numeric field, for totals across a request such as Admin API calls. */
export function count(field: string, by = 1) {
  const event = currentEvent.getStore();

  if (event) {
    event[field] = (Number(event[field]) || 0) + by;
  }
}

/**
 * The parts of an error that are safe to log. Shopify's errors also carry response bodies, which can
 * hold customer data.
 */
export function describeError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };
}

/** Runs `work` as one event and emits exactly one log line for it, however it ends. */
export async function withWideEvent<T>(
  name: string,
  fields: Fields,
  work: () => Promise<T>,
): Promise<T> {
  const event = { ...fields };
  const startedAt = Date.now();

  try {
    return await currentEvent.run(event, work);
  } catch (error) {
    event.error = describeError(error);
    throw error;
  } finally {
    event.duration_ms = Date.now() - startedAt;
    logger[event.error ? "error" : "info"](name, event);
  }
}
