-- TypeStory progress sync — target schema.
--
-- lib/progress-store.ts ships a filesystem store so the API runs with zero
-- infrastructure. This is the PostgreSQL schema that store should be swapped for
-- once there is a real database. The route contract does not change: only the
-- three methods on ProgressStore.

create table if not exists typing_progress (
  device_id      text        primary key,
  schema_version integer     not null default 1,
  payload        jsonb       not null,
  updated_at     timestamptz not null default now(),

  constraint typing_progress_device_id_format
    check (device_id ~ '^[A-Za-z0-9_-]{8,64}$')
);

-- Supports "when did anyone last sync" style admin/ops queries.
create index if not exists typing_progress_updated_at_idx
  on typing_progress (updated_at desc);

-- Reads never filter inside the document today, so GIN is unnecessary. Add it only
-- alongside a real query, e.g.:
--   create index typing_progress_payload_gin on typing_progress using gin (payload);
--
-- ------------------------------------------------------------------
-- Once auth exists, `device_id` becomes `user_id uuid references auth.users(id)`
-- and the JSONB column can be normalised once reporting needs it:
--
--   create table typing_sessions (
--     id           uuid         primary key default gen_random_uuid(),
--     user_id      uuid         not null references auth.users(id) on delete cascade,
--     occurred_at  timestamptz  not null,
--     source_type  text         not null check (source_type in ('story','vocab','custom')),
--     title        text         not null check (char_length(title) <= 120),
--     wpm          integer      not null check (wpm between 0 and 400),
--     accuracy     numeric(5,2) not null check (accuracy between 0 and 100),
--     duration_s   integer      not null check (duration_s >= 0),
--     words_count  integer      not null check (words_count >= 0),
--     keystrokes   integer      not null check (keystrokes >= 0)
--   );
--
--   create index typing_sessions_user_recent_idx
--     on typing_sessions (user_id, occurred_at desc);
--
-- Do not normalise before there is a query that needs it: the JSONB shape is
-- what makes a schema change a non-event for shipped clients.
