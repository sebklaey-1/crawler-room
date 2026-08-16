/**
 * Shapes of the model-visible result objects that the Markdown renderers and
 * the per-tool `summary()` callbacks consume.
 *
 * These types are intentionally structural and optional: a handler returns the
 * branch of its published output schema, so a summary only ever reads the
 * fields that may exist. The index signature keeps unlisted (already schema
 * validated) fields readable via bracket access without `any`.
 */

export interface MessageView {
  id?: string;
  alias?: string;
  text?: string;
  created_at?: string;
  likes?: number;
  liked_by_me?: boolean;
  is_self?: boolean;
  is_owner?: boolean;
}

export interface ImageView {
  id?: string;
  url?: string;
  alias?: string;
  alt_text?: string;
  likes?: number;
}

export interface ProfileView {
  handle?: string;
  display_name?: string;
  bio?: string | null;
  location?: string | null;
  external_url?: string | null;
  profile_image_url?: string | null;
  banner_image_url?: string | null;
  joined_at?: string;
  visibility?: string;
  is_owner?: boolean;
  followers?: number | null;
  following?: number | null;
  likes_received?: number | null;
  people_here_now?: number;
}

export interface RoomView {
  room_name?: string;
  handle?: string;
  followers?: number;
  people_here_now?: number;
  online_now?: number;
  title?: string;
  description?: string;
}

export interface LabelledEntry {
  id?: string;
  slug?: string | null;
  handle?: string;
  title?: string;
  name?: string;
  alias?: string;
  display_name?: string;
  message?: string;
  role?: string;
  members?: number;
  followers?: number;
}

export interface DailyPoint {
  day?: string;
  profile_view?: number;
}

/** Everything a renderer or summary may read from a handler result. */
export interface SummaryResult {
  readonly [key: string]: unknown;
  action?: string;
  message?: unknown;
  headline?: string;
  notice?: string;
  reported?: boolean;
  already_reported?: boolean;
  status?: string;
  receipt?: string;
  room?: RoomView;
  community?: LabelledEntry;
  profile?: ProfileView;
  tabs?: { messages?: MessageView[]; images?: ImageView[] };
  messages?: MessageView[];
  recent_messages?: MessageView[];
  images?: ImageView[];
  blocks?: LabelledEntry[];
  notifications?: LabelledEntry[];
  followers?: LabelledEntry[] | number;
  rooms?: LabelledEntry[];
  communities?: LabelledEntry[];
  organizations?: LabelledEntry[];
  members?: LabelledEntry[];
  total?: number;
  handle?: string;
  range_days?: number;
  daily?: DailyPoint[];
  profile_views?: number;
  unique_visitors?: number;
  new_followers?: number;
  unfollows?: number;
  likes?: number;
  message_views?: number;
  image_views?: number;
  link_clicks?: number;
  room_visits?: number;
  engagement_rate_percent?: number;
  average_visit_seconds?: number;
  online_now?: number;
  followers_total?: number;
  likes_total?: number;
}
