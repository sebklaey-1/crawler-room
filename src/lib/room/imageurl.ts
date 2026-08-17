/**
 * Stable, absolute image URLs for MCP results.
 *
 * ChatGPT can only render an image when the result carries a plain https URL
 * that stays reachable while the answer is displayed. Short-lived signed
 * storage URLs are therefore never handed out directly: every image is served
 * through this app's own public image route, addressed by a signed opaque id.
 */
import { PRODUCTION_ORIGIN } from "./auth";
import { encodeImageId, encodeProfileImageId } from "./ids";
import type { ProfileImageKind } from "./profile";

/** Absolute public URL of one approved room image. */
export async function publicImageUrl(imageId: number | string): Promise<string> {
  return `${PRODUCTION_ORIGIN}/api/public/room/image/${await encodeImageId(imageId)}`;
}

/** Absolute public URL of a profile avatar or banner. */
export async function publicProfileImageUrl(
  roomId: string,
  kind: ProfileImageKind,
): Promise<string> {
  return `${PRODUCTION_ORIGIN}/api/public/room/image/${await encodeProfileImageId(roomId, kind)}`;
}
