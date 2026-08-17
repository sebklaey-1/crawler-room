/**
 * Plain-language labels for the scopes shown on the consent screen.
 * Browser-safe: no server imports, no secrets.
 */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: "Deine anonyme Crawler-Room-Verbindung bestätigen",
  profile: "Dein öffentliches Crawler Room-Basisprofil teilen",
  "room:private": "Deine privaten Räume, Benachrichtigungen und Analytics lesen",
  "room:write": "In deinem Namen schreiben, folgen, liken und verwalten",
};
