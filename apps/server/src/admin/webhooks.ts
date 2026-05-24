import { createHmac } from 'node:crypto';
import type { AdminConfigStore } from './config.js';
import type { WebhookEvent, WebhookSubscription } from './config.js';

/**
 * Webhook dispatcher.
 *
 * Fires HTTP POST to every subscribed URL when a server-side event
 * occurs. HMAC-SHA256 signs the payload when the subscription has a
 * secret; receivers verify via `X-Casual-Signature: sha256=<hex>`.
 *
 * Fire-and-forget on the hot path — the in-flight request that
 * triggered an event isn't held while we dispatch. Failed dispatches
 * are logged + retried once after a 5 s back-off; longer retry chains
 * are out of scope (v0.2 ships a proper queue with exponential
 * backoff + dead-letter store).
 *
 * The dispatcher reloads the config on every dispatch — cheap (small
 * JSON), and means admin-panel edits to webhook subscriptions take
 * effect immediately without a restart.
 */
export class WebhookDispatcher {
  constructor(
    private readonly store: AdminConfigStore,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly log: { info: (...a: any[]) => void; warn: (...a: any[]) => void },
  ) {}

  /** Fire all subscriptions for `event`. Resolves immediately;
   *  network IO runs in background. */
  emit(event: WebhookEvent, payload: Record<string, unknown>): void {
    // Wrap in setImmediate so the calling Fastify handler returns
    // before any blocking work begins.
    setImmediate(() => {
      void this.dispatchAll(event, payload).catch((err) => {
        this.log.warn(`[webhooks] dispatchAll failed: ${(err as Error).message}`);
      });
    });
  }

  private async dispatchAll(
    event: WebhookEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const cfg = await this.store.load();
    const subs = (cfg.webhooks ?? []).filter((s) => {
      if (!s.enabled) return false;
      if (s.events.length === 0) return true; // empty list = subscribed to all
      return s.events.includes(event);
    });
    if (subs.length === 0) return;

    const body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      payload,
    });

    await Promise.all(subs.map((sub) => this.dispatchOne(sub, event, body)));
  }

  private async dispatchOne(
    sub: WebhookSubscription,
    event: WebhookEvent,
    body: string,
    attempt = 1,
  ): Promise<void> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'CasualSheets-Webhook/0.1',
      'x-casual-event': event,
      'x-casual-attempt': String(attempt),
    };
    if (sub.secret) {
      const sig = createHmac('sha256', sub.secret).update(body).digest('hex');
      headers['x-casual-signature'] = `sha256=${sig}`;
    }
    try {
      const res = await fetch(sub.url, {
        method: 'POST',
        headers,
        body,
        // Cap inbound failure cost — slow receivers shouldn't pile
        // up open sockets here.
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        this.log.warn(
          `[webhooks] ${sub.name} → ${event} got ${res.status} ${res.statusText} (attempt ${attempt})`,
        );
        if (attempt === 1) {
          setTimeout(() => void this.dispatchOne(sub, event, body, 2), 5_000);
        }
      } else {
        this.log.info(
          `[webhooks] ${sub.name} → ${event} ${res.status} (attempt ${attempt})`,
        );
      }
    } catch (err) {
      this.log.warn(
        `[webhooks] ${sub.name} → ${event} network err: ${(err as Error).message} (attempt ${attempt})`,
      );
      if (attempt === 1) {
        setTimeout(() => void this.dispatchOne(sub, event, body, 2), 5_000);
      }
    }
  }
}
