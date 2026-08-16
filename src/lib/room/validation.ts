/**
 * Message validation and safe text handling.
 * Messages are stored as plain text and never rendered as HTML.
 */
import { roomError } from "./errors";

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s]+/giu;

export function countUrls(text: string): number {
  return (text.match(URL_PATTERN) ?? []).length;
}

/** Escapes HTML special characters. Used for any surface that renders text. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface MessageLimits {
  maxLength: number;
  maxLinks: number;
}

/**
 * Validates and normalizes a message body.
 * Throws RoomError with MESSAGE_EMPTY / MESSAGE_TOO_LONG / TOO_MANY_LINKS.
 */
export function validateMessage(raw: unknown, limits: MessageLimits): string {
  if (typeof raw !== "string") throw roomError("MESSAGE_EMPTY");

  const normalized = raw
    .normalize("NFKC")
    // control characters except newline and tab
    // eslint-disable-next-line no-control-regex -- intentional control/bidi character sanitiser
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  if (normalized.length < 1) throw roomError("MESSAGE_EMPTY");

  const characters = Array.from(normalized);
  if (characters.length > limits.maxLength) throw roomError("MESSAGE_TOO_LONG");
  if (countUrls(normalized) > limits.maxLinks) throw roomError("TOO_MANY_LINKS");

  return normalized;
}

export function clampLimit(value: unknown, fallback = 20, min = 1, max = 50): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
