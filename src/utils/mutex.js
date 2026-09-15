/**
 * Per-key serialisation queue.
 *
 * WhatsApp can deliver several webhooks for the same conversation almost
 * simultaneously. Without serialisation, two handlers read the same
 * conversation document, both mutate it and the second write silently
 * discards the first (lost bot step, wrong unread count, messages stored
 * out of order). Chaining work per conversation makes each turn atomic
 * from the application's point of view.
 *
 * This is an in-process lock: correct for a single API instance. Running
 * multiple instances would need a distributed lock (e.g. Redis) keyed the
 * same way.
 */
const chains = new Map();

export function withLock(key, task) {
  const previous = chains.get(key) ?? Promise.resolve();

  // Run the task whether or not the previous one succeeded.
  const run = previous.then(task, task);

  // Keep the chain alive but never let a rejection break the next caller.
  const link = run.catch(() => undefined);
  chains.set(key, link);

  // Drop the entry once this is the last queued task, so the map cannot grow
  // without bound across many conversations.
  link.then(() => {
    if (chains.get(key) === link) chains.delete(key);
  });

  return run;
}

export const pendingLockCount = () => chains.size;
