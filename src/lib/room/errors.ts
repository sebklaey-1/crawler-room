/**
 * Structured, user-safe errors. Never leak SQL, stack traces, keys or
 * database identifiers to the model or the user.
 */

export type RoomErrorCode =
  | "RATE_LIMITED"
  | "MESSAGE_EMPTY"
  | "MESSAGE_TOO_LONG"
  | "TOO_MANY_LINKS"
  | "NOT_A_MEMBER"
  | "TOPIC_NOT_FOUND"
  | "IDENTITY_UNAVAILABLE"
  | "ROOM_UNAVAILABLE"
  | "INVALID_INPUT"
  | "MESSAGE_NOT_FOUND"
  | "INTERNAL_ERROR";

const DEFAULT_MESSAGES: Record<RoomErrorCode, string> = {
  RATE_LIMITED: "Du warst gerade sehr aktiv. Bitte versuche es in einer Minute noch einmal.",
  MESSAGE_EMPTY: "Deine Nachricht ist leer. Schreibe kurz, was du sagen möchtest.",
  MESSAGE_TOO_LONG: "Deine Nachricht ist zu lang. Erlaubt sind höchstens 500 Zeichen.",
  TOO_MANY_LINKS: "Deine Nachricht enthält zu viele Links. Erlaubt sind höchstens zwei.",
  NOT_A_MEMBER: "Du bist in diesem Thema aktuell in keinem Raum.",
  TOPIC_NOT_FOUND: "Dieses Thema kenne ich nicht.",
  IDENTITY_UNAVAILABLE:
    "Ich konnte deine anonyme Kennung nicht ermitteln. Bitte öffne @room in einer unterstützten ChatGPT-Oberfläche, die Plugin-Kennungen übermittelt.",
  ROOM_UNAVAILABLE: "Dein Raum ist gerade nicht verfügbar. Bitte versuche es erneut.",
  INVALID_INPUT: "Die Angaben waren unvollständig oder ungültig.",
  MESSAGE_NOT_FOUND: "Diese Nachricht ist nicht (mehr) verfügbar.",
  INTERNAL_ERROR: "Da ist etwas schiefgelaufen. Bitte versuche es später noch einmal.",
};

export class RoomError extends Error {
  readonly code: RoomErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: RoomErrorCode, message?: string, details: Record<string, unknown> = {}) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = "RoomError";
    this.code = code;
    this.details = details;
  }

  toPayload() {
    return { error: { code: this.code, message: this.message, ...this.details } };
  }
}

export function roomError(
  code: RoomErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): RoomError {
  return new RoomError(code, message, details);
}

export function toRoomError(unknownError: unknown): RoomError {
  if (unknownError instanceof RoomError) return unknownError;
  // Everything else is treated as internal: never surface raw details.
  return new RoomError("INTERNAL_ERROR");
}
