import { createFileRoute } from "@tanstack/react-router";

/**
 * Payments webhook receiver.
 * Public by necessity — the caller is authenticated by verifying the payment
 * provider's signature over the raw body before anything is processed.
 */
export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return Response.json({ received: true, ignored: "invalid env" });
        }

        const rawBody = await request.text();
        const { verifyStripeSignature, processStripeEvent } = await import("@/lib/room/billing");

        const valid = await verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), rawEnv);
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
          return new Response("Processing error", { status: 500 });
        }
      },
    },
  },
});
