/**
 * MCP tool descriptors for personal rooms, following and notifications.
 * Registered alongside the core chat tools in `mcp.ts`.
 */
import type { McpMeta } from "./identity";
import {
  handleFollowRoom,
  handleLeaveRoom,
  handleListFollowing,
  handleMyRoom,
  handleNotificationSettings,
  handleOpenRoom,
  handleRoomNotifications,
  handleSendRoomMessage,
  handleUnfollowRoom,
  handleUpdateMyRoom,
} from "./tools.personal";

type Json = Record<string, unknown>;

export interface PersonalToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  outputSchema: Json;
  annotations: Json;
  handler: (input: unknown, meta: McpMeta) => Promise<Json>;
  summary: (result: any) => string;
}

const OPEN_OUTPUT: Json = { type: "object", additionalProperties: true };

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
};
const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
  idempotentHint: false,
};

const usernameInput: Json = {
  type: "object",
  properties: {
    username: {
      type: "string",
      description: "Handle des Raumbesitzers, mit oder ohne @ (z. B. «@sebastian»).",
    },
  },
  required: ["username"],
  additionalProperties: false,
};

function feed(result: any): string {
  const messages = (result.recent_messages ?? result.messages ?? []) as Array<{
    alias: string;
    text: string;
  }>;
  const images = (result.images ?? []) as Array<{ alias: string; alt_text: string; url: string }>;
  const body = messages.length
    ? `\n\n${messages.map((m) => `• ${m.alias}: ${m.text}`).join("\n")}`
    : "\n\nNoch keine Nachrichten in diesem Raum.";
  const pics = images.length
    ? `\n\n${images.map((i) => `![${i.alt_text || "Bild"}](${i.url}) — ${i.alias}`).join("\n")}`
    : "";
  return body + pics;
}

export const PERSONAL_TOOLS: PersonalToolDefinition[] = [
  {
    name: "my_room",
    title: "Mein Raum",
    description:
      "Zeigt den eigenen persönlichen Raum (wird beim ersten Aufruf automatisch angelegt und heisst nach dem Anzeigenamen, z. B. «Sebastian's Room»). Liefert Follower-Zahl, aktuell anwesende Personen, Anwesenheitsliste, Follower-Liste, neue Follower als Aktivität sowie Nachrichten und Bilder. Kein Login nötig.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: OPEN_OUTPUT,
    annotations: READ_ONLY,
    handler: (input, meta) => handleMyRoom(input, meta) as Promise<Json>,
    summary: (result) =>
      `${result.room.room_name} (@${result.room.handle}) — ${result.dashboard_message}.${feed(result)}`,
  },
  {
    name: "update_my_room",
    title: "Eigenen Raum bearbeiten",
    description:
      "Ändert Name und Beschreibung des eigenen persönlichen Raums. Nur der Besitzer kann seinen Raum bearbeiten; der Raum kann nicht gelöscht werden.",
    inputSchema: {
      type: "object",
      properties: {
        room_name: { type: "string" },
        description: { type: "string", description: "Kurze Beschreibung, max. 280 Zeichen." },
      },
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleUpdateMyRoom(input, meta) as Promise<Json>,
    summary: (result) => String(result.message),
  },
  {
    name: "open_room",
    title: "Persönlichen Raum betreten",
    description:
      "Betritt den öffentlichen persönlichen Raum einer Person (@username). Liefert Raumname, Besitzer, Beschreibung, Online-Status des Besitzers, Follower-Zahl, aktuell anwesende Personen, Chatverlauf und Bilder sowie den Zustand des Follow-Buttons.",
    inputSchema: usernameInput,
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleOpenRoom(input, meta) as Promise<Json>,
    summary: (result) =>
      `${result.room.room_name} — ${result.room.headline}. [${result.follow_button ?? "Room Owner"}]${feed(result)}`,
  },
  {
    name: "leave_room",
    title: "Persönlichen Raum verlassen",
    description:
      "Verlässt den persönlichen Raum einer Person. Das beendet nur die Anwesenheit; eine bestehende Follow-Beziehung und die Follower-Zahl bleiben unverändert.",
    inputSchema: usernameInput,
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleLeaveRoom(input, meta) as Promise<Json>,
    summary: (result) => String(result.message),
  },
  {
    name: "send_room_message",
    title: "In persönlichen Raum schreiben",
    description:
      "Schreibt eine Nachricht in den persönlichen Raum einer Person (@username) und liefert sofort den aktuellen Chatverlauf und alle Bilder zurück. Diese müssen in derselben Antwort vorgelesen bzw. angezeigt werden.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string" },
        text: { type: "string", description: "Nachricht, max. 500 Zeichen." },
      },
      required: ["username", "text"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleSendRoomMessage(input, meta) as Promise<Json>,
    summary: (result) => `${result.room.room_name} — ${result.room.headline}.${feed(result)}`,
  },
  {
    name: "follow_room",
    title: "Raum folgen",
    description:
      "Folgt dem persönlichen Raum einer Person dauerhaft (Chat-Befehl «@rooms follow @username» oder Button «Follow Room»). Mehrfaches Folgen ist unmöglich; dem eigenen Raum kann man nicht folgen.",
    inputSchema: usernameInput,
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleFollowRoom(input, meta) as Promise<Json>,
    summary: (result) => `${result.message} [Following] — ${result.headline}.`,
  },
  {
    name: "unfollow_room",
    title: "Raum entfolgen",
    description:
      "Beendet das Folgen eines persönlichen Raums («@rooms unfollow @username» oder Button «Unfollow»).",
    inputSchema: usernameInput,
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleUnfollowRoom(input, meta) as Promise<Json>,
    summary: (result) => `${result.message} [Follow Room] — ${result.headline}.`,
  },
  {
    name: "following_rooms",
    title: "Räume, denen ich folge",
    description:
      "Listet alle persönlichen Räume, denen die Person folgt, mit Follower-Zahl und aktuell anwesenden Personen.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: OPEN_OUTPUT,
    annotations: READ_ONLY,
    handler: (input, meta) => handleListFollowing(input, meta) as Promise<Json>,
    summary: (result) =>
      `${result.message}${((result.rooms ?? []) as any[])
        .map(
          (r) =>
            `\n• ${r.room_name} (@${r.handle}) — ${r.followers} followers · ${r.people_here_now} here now`,
        )
        .join("")}`,
  },
  {
    name: "room_notifications",
    title: "Meldungen",
    description:
      "Zeigt Meldungen rund um persönliche Räume: neue Follower, neue Gespräche, öffentliche Nachrichten und startende Live-Gespräche.",
    inputSchema: {
      type: "object",
      properties: {
        only_unread: { type: "boolean" },
        mark_read: { type: "boolean" },
      },
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: READ_ONLY,
    handler: (input, meta) => handleRoomNotifications(input, meta) as Promise<Json>,
    summary: (result) =>
      `${result.message}${((result.notifications ?? []) as any[])
        .map((n) => `\n• ${n.message}`)
        .join("")}`,
  },
  {
    name: "notification_settings",
    title: "Benachrichtigungen einstellen",
    description:
      "Schaltet einzelne Benachrichtigungen an oder aus: new_conversation (Owner startet ein neues Gespräch), public_message (Owner postet öffentlich), live_event (geplantes Live-Gespräch startet), new_follower. Ohne Angaben werden die aktuellen Einstellungen angezeigt.",
    inputSchema: {
      type: "object",
      properties: {
        new_conversation: { type: "boolean" },
        public_message: { type: "boolean" },
        live_event: { type: "boolean" },
        new_follower: { type: "boolean" },
      },
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleNotificationSettings(input, meta) as Promise<Json>,
    summary: (result) =>
      `${result.message} Aktuell: ${Object.entries(result.settings)
        .map(([key, value]) => `${key}=${value ? "an" : "aus"}`)
        .join(", ")}.`,
  },
];
