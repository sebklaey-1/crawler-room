/**
 * MCP tool descriptors for plans, owned rooms, the Universal Room and
 * advertising. Registered alongside the core chat tools in `mcp.ts`.
 */
import type { McpMeta } from "./identity";
import {
  handleAdminReviewCampaign,
  handleCreateInvitation,
  handleCreatePrivateRoom,
  handleCreateSponsoredCampaign,
  handleEnterUniversal,
  handleGetCampaignAnalytics,
  handleGetMyPlan,
  handleHideSponsoredPlacement,
  handleJoinInvitation,
  handleListUniversal,
  handleManageCampaign,
  handleManageRoom,
  handleReportSponsoredPlacement,
  handleSendUniversalMessage,
  handleSubmitCampaignForReview,
} from "./tools.plus";

type Json = Record<string, unknown>;

export interface PlusToolDefinition {
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

function feedSummary(result: any): string {
  const messages = (result.messages ?? []) as Array<{ alias: string; text: string }>;
  const head = `Universal Room — ${result.room?.presence ?? "öffentlich"}.`;
  const body = messages.length
    ? `\n\n${messages.map((m) => `• ${m.alias}: ${m.text}`).join("\n")}`
    : "\n\nNoch keine Nachrichten im sichtbaren Zeitfenster.";
  const sponsored = (result.sponsored ?? []) as Array<{ title: string; organization: string }>;
  const ads = sponsored.length
    ? `\n\nAnzeige (Gesponserter Raum): ${sponsored.map((s) => `${s.title} — ${s.organization}`).join(" · ")}`
    : "";
  return head + body + ads;
}

export const PLUS_TOOLS: PlusToolDefinition[] = [
  {
    name: "get_my_plan",
    title: "Meine Möglichkeiten",
    description:
      "Zeigt alle freigeschalteten Möglichkeiten (Erweiterungen), Limits und die aktuelle Nutzung. @room ist vollständig kostenlos: es gibt keine Abos, keine Pläne und keine Preise — nenne niemals Kosten.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: OPEN_OUTPUT,
    annotations: READ_ONLY,
    handler: (input, meta) => handleGetMyPlan(input, meta) as Promise<Json>,
    summary: (result) => `Alle Möglichkeiten sind freigeschaltet. ${result.notice}`,
  },
  {
    name: "create_private_room",
    title: "Eigenen Raum erstellen",
    description:
      "Erstellt einen eigenen Raum (für alle kostenlos). Limits für Kapazität und Anzahl Räume werden serverseitig geprüft.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        topic: { type: "string" },
        visibility: { type: "string", enum: ["public", "private", "invite", "paid"] },
        capacity: { type: "integer" },
        organization_id: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleCreatePrivateRoom(input, meta) as Promise<Json>,
    summary: (result) => String(result.message ?? "Raum erstellt."),
  },
  {
    name: "manage_room",
    title: "Raum verwalten",
    description:
      "Verwaltet einen eigenen Raum: update, archive, delete, change_visibility, update_retention, assign_moderator, remove_moderator.",
    inputSchema: {
      type: "object",
      properties: {
        room_id: { type: "string" },
        action: {
          type: "string",
          enum: [
            "update",
            "archive",
            "delete",
            "change_visibility",
            "update_retention",
            "assign_moderator",
            "remove_moderator",
          ],
        },
        payload: { type: "object", additionalProperties: true },
      },
      required: ["room_id", "action"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: { ...WRITE, destructiveHint: true },
    handler: (input, meta) => handleManageRoom(input, meta) as Promise<Json>,
    summary: (result) => String(result.message ?? "Raum aktualisiert."),
  },
  {
    name: "create_invitation",
    title: "Einladung erstellen",
    description:
      "Erstellt eine sichere, widerrufbare Einladung für einen eigenen Raum. Mit 'revoke_token' wird eine Einladung widerrufen.",
    inputSchema: {
      type: "object",
      properties: {
        room_id: { type: "string" },
        expires_in_hours: { type: "integer" },
        max_uses: { type: "integer" },
        revoke_token: { type: "string" },
      },
      required: ["room_id"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleCreateInvitation(input, meta) as Promise<Json>,
    summary: (result) => String(result.message ?? "Einladung erstellt."),
  },
  {
    name: "join_invitation",
    title: "Einladung einlösen",
    description: "Tritt einem Raum über einen Einladungscode bei.",
    inputSchema: {
      type: "object",
      properties: { invitation_token: { type: "string" } },
      required: ["invitation_token"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleJoinInvitation(input, meta) as Promise<Json>,
    summary: (result) => String(result.message ?? "Beigetreten."),
  },
  {
    name: "enter_universal",
    title: "Universal Room betreten",
    description:
      "Betritt den globalen öffentlichen Universal Room und liefert den aktuellen öffentlichen Zustand. Erzeugt keine doppelten Mitgliedschaften.",
    inputSchema: {
      type: "object",
      properties: { alias: { type: "string" } },
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: { ...WRITE, idempotentHint: true },
    handler: (input, meta) => handleEnterUniversal(input, meta) as Promise<Json>,
    summary: feedSummary,
  },
  {
    name: "list_universal",
    title: "Universal Room lesen",
    description:
      "Liefert öffentliche Nachrichten (mit Cursor-Pagination), Trend-Themen, aktive öffentliche Räume, kommende Events und freigegebene gesponserte Karten.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        topic: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: { ...READ_ONLY, readOnlyHint: false },
    handler: (input, meta) => handleListUniversal(input, meta) as Promise<Json>,
    summary: feedSummary,
  },
  {
    name: "send_universal_message",
    title: "Im Universal Room schreiben",
    description:
      "Sendet eine normale Nachricht in den Universal Room. Rate-Limits, Spam-Schutz und ein optionaler Idempotenz-Schlüssel gelten serverseitig.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" }, idempotency_key: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleSendUniversalMessage(input, meta) as Promise<Json>,
    summary: feedSummary,
  },
  {
    name: "hide_sponsored_placement",
    title: "Anzeige ausblenden",
    description: "Blendet eine gesponserte Karte für diese Person dauerhaft aus.",
    inputSchema: {
      type: "object",
      properties: { campaign_id: { type: "string" } },
      required: ["campaign_id"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleHideSponsoredPlacement(input, meta) as Promise<Json>,
    summary: (result) => String(result.message ?? "Anzeige ausgeblendet."),
  },
  {
    name: "report_sponsored_placement",
    title: "Anzeige melden",
    description: "Meldet eine gesponserte Karte zur Prüfung.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        reason: {
          type: "string",
          enum: ["spam", "misleading", "offensive", "scam", "irrelevant", "other"],
        },
      },
      required: ["campaign_id", "reason"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleReportSponsoredPlacement(input, meta) as Promise<Json>,
    summary: (result) => String(result.message ?? "Gemeldet."),
  },
  {
    name: "create_sponsored_campaign",
    title: "Gesponserten Raum anlegen",
    description:
      "Nur für Business-Organisationen: legt eine Kampagne als Entwurf an. Kampagnen werden nie automatisch veröffentlicht.",
    inputSchema: {
      type: "object",
      properties: {
        organization_id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        topics: { type: "array", items: { type: "string" } },
        cover_image_reference: { type: "string" },
        call_to_action: { type: "string" },
        destination_url: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        budget_cents: { type: "integer" },
        languages: { type: "array", items: { type: "string" } },
      },
      required: ["organization_id", "title", "description", "topics"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleCreateSponsoredCampaign(input, meta) as Promise<Json>,
    summary: (result) => String(result.message ?? "Kampagne erstellt."),
  },
  {
    name: "submit_campaign_for_review",
    title: "Kampagne einreichen",
    description:
      "Reicht eine Kampagne zur Prüfung ein. Geprüft werden verifizierte Organisation, Vollständigkeit, Richtlinien und Zielseite.",
    inputSchema: {
      type: "object",
      properties: { campaign_id: { type: "string" } },
      required: ["campaign_id"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleSubmitCampaignForReview(input, meta) as Promise<Json>,
    summary: (result) => String(result.message ?? "Eingereicht."),
  },
  {
    name: "manage_campaign",
    title: "Kampagne verwalten",
    description:
      "Aktionen: update, pause, resume, cancel. Inhaltliche Änderungen erfordern eine neue Prüfung.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        action: { type: "string", enum: ["update", "pause", "resume", "cancel"] },
        payload: { type: "object", additionalProperties: true },
      },
      required: ["campaign_id", "action"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleManageCampaign(input, meta) as Promise<Json>,
    summary: (result) => String(result.message ?? "Kampagne aktualisiert."),
  },
  {
    name: "get_campaign_analytics",
    title: "Kampagnen-Auswertung",
    description:
      "Aggregierte, datenschutzsichere Auswertung der eigenen Kampagnen. Keine Einzelprofile, keine Gesprächsinhalte.",
    inputSchema: {
      type: "object",
      properties: { organization_id: { type: "string" } },
      required: ["organization_id"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: READ_ONLY,
    handler: (input, meta) => handleGetCampaignAnalytics(input, meta) as Promise<Json>,
    summary: (result) => `Kampagnen: ${(result.campaigns ?? []).length}.`,
  },
  {
    name: "admin_review_campaign",
    title: "Kampagne prüfen (Plattform)",
    description:
      "Nur für Plattform-Administration: approve, reject, request_changes oder suspend. Jede Entscheidung wird protokolliert.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        action: { type: "string", enum: ["approve", "reject", "request_changes", "suspend"] },
        reason: { type: "string" },
      },
      required: ["campaign_id", "action"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: { ...WRITE, destructiveHint: true },
    handler: (input, meta) => handleAdminReviewCampaign(input, meta) as Promise<Json>,
    summary: (result) => String(result.message ?? "Geprüft."),
  },
];
