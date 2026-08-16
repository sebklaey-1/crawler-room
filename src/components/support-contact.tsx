import { publicSupportEmail } from "@/lib/room/legal";

/**
 * Renders the configured public support address. When no address is
 * configured, no fake contact is shown — the form stays the only channel.
 */
export function SupportContact() {
  const email = publicSupportEmail();
  if (!email) {
    return (
      <p className="text-sm text-muted-foreground">
        No public email address is configured for this deployment. Please use the form on this page
        — every submission returns an opaque case reference you can quote later.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      You can also write to{" "}
      <a className="underline underline-offset-4" href={`mailto:${email}`}>
        {email}
      </a>
      .
    </p>
  );
}
