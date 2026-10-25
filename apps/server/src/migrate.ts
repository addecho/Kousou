import { sql } from "./db.js";
await sql.begin(async (tx) => {
  await tx`select pg_advisory_xact_lock(12943788)`;
  await tx`create table if not exists schema_versions (version integer primary key, installed_at timestamptz not null default now())`;
  const done = await tx`select version from schema_versions where version=1`;
  if (done.length) return;
  await tx`create table workspaces(id uuid primary key, key_hash text unique not null, created_at timestamptz not null default now())`;
  await tx`create table sessions(token_hash text primary key,workspace_id uuid not null references workspaces(id) on delete cascade,expires_at timestamptz not null)`;
  await tx`create index sessions_workspace on sessions(workspace_id)`;
  await tx`create table checkout_plans(id uuid primary key,workspace_id uuid not null references workspaces(id) on delete cascade,revision integer not null default 1 check(revision>0),document jsonb not null,updated_at timestamptz not null default now(),unique(id,workspace_id))`;
  await tx`create index plans_workspace on checkout_plans(workspace_id,updated_at desc)`;
  await tx`create table calculation_snapshots(id uuid primary key,workspace_id uuid not null,plan_id uuid not null,revision integer not null,input jsonb not null,result jsonb not null,engine_version text not null,input_hash text not null,request_id uuid not null,created_at timestamptz not null default now(),foreign key(plan_id,workspace_id) references checkout_plans(id,workspace_id) on delete cascade,unique(workspace_id,request_id))`;
  await tx`create index snapshots_plan on calculation_snapshots(workspace_id,plan_id,created_at desc)`;
  await tx`insert into schema_versions(version) values(1)`;
});
console.log("Database schema version 1 ready.");
await sql.end();
