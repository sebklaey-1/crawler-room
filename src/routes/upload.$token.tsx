/**
 * One-time upload page for a profile image.
 *
 * The assistant hands out this link when a person wants to use a picture from
 * their device or chat: the file is uploaded straight into Crawler Room and
 * becomes reachable under a stable public image URL.
 */
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/upload/$token")({
  head: () => ({
    meta: [
      { title: "Upload your picture — Crawler Room" },
      {
        name: "description",
        content:
          "Securely upload your Crawler Room profile picture or banner from this one-time link.",
      },
      { property: "og:title", content: "Upload your picture — Crawler Room" },
      {
        property: "og:description",
        content: "Securely upload your Crawler Room profile picture or banner.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UploadPage,
});

function UploadPage() {
  const { token } = useParams({ from: "/upload/$token" });
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState<string | null>(null);

  async function upload(file: File) {
    setStatus("busy");
    setMessage("Uploading …");
    try {
      const response = await fetch("/api/public/room/profile-upload", {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream", "x-room-upload-token": token },
        body: file,
      });
      const body = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !body.url) {
        setStatus("error");
        setMessage(
          body.error === "image_too_large"
            ? "That file is too large."
            : body.error === "unauthorized"
              ? "This upload link has expired. Ask for a new one in the chat."
              : "Only JPG, PNG or WebP images are accepted.",
        );
        return;
      }
      setUrl(body.url);
      setStatus("done");
      setMessage("Saved. Your picture is live — go back to the chat.");
    } catch {
      setStatus("error");
      setMessage("Upload failed. Please try again.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Upload your picture</h1>
        <p className="text-sm text-muted-foreground">
          Choose a JPG, PNG or WebP image. It is stored in Crawler Room and shown on your profile.
        </p>
      </div>

      <label className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground hover:bg-muted/40">
        <span>Tap to choose an image</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <Button type="button" variant="secondary" asChild={false} disabled={status === "busy"}>
          {status === "busy" ? "Uploading …" : "Select file"}
        </Button>
      </label>

      {message ? (
        <p
          className={
            status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
        >
          {message}
        </p>
      ) : null}

      {url ? (
        <img src={url} alt="Your uploaded profile picture" className="rounded-lg border border-border" />
      ) : null}
    </main>
  );
}
