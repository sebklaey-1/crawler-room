import { createFileRoute } from "@tanstack/react-router";

/**
 * Stripe webhook receiver.
 * Public route by necessity — the caller is authenticated by verifying the
 * Stripe signature over the raw body before anything is processed.
 */
export const Route = createFileRoute("/api/public/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const { verifyStripeSignature, processStripeEvent } = await import("@/lib/room/billing");

        const valid = await verifyStripeSignature(rawBody, request.headers.get("stripe-signature"));
        if (!valid) return new Response("Invalid signature", { status: 401 });

        let event: unknown;
        try {
          event = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid payload", { status: 400 });
        }

        const { getDb } = await import("@/lib/room/store");
        try {
          const result = await processStripeEvent(await getDb(), event as any);
          return Response.json({ received: true, ...result });
        } catch {
          // Signal a retry to Stripe without leaking internals.
          return new Response("Processing error", { status: 500 });
        }
      },
    },
  },
});
