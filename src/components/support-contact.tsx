import { publicSupportEmail } from "@/lib/room/legal";

/**
 * Renders the confirmed public support address next to the support form.
 * Both channels stay available; neither promises an immediate reply.
 */
export function SupportContact() {
  const email = publicSupportEmail();
  return (
    <p className="text-sm text-muted-foreground">
      You can also write to{" "}
      <a className="underline underline-offset-4" href={`mailto:${email}`}>
        {email}
      </a>
      . The form on this page stays available as well and returns an opaque case reference you can
      quote later.
    </p>
  );
}
