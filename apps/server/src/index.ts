import "dotenv/config";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { randomBytes, randomUUID, createHmac, createHash } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { planSchema, saveSchema } from "@kousou/contracts";
import {
  ENGINE_VERSION,
  calculate,
  emptyPlan,
  examplePlan,
} from "@kousou/core";
import { sql, db, plans } from "./db.js";
const pepper = process.env.SESSION_PEPPER;
if (!pepper || pepper.length < 32)
  throw new Error("SESSION_PEPPER must contain at least 32 characters");
const digest = (s: string) =>
  createHmac("sha256", pepper).update(s).digest("hex");
const app = Fastify({
  logger: {
    level: "info",
    redact: ["req.headers.cookie", "req.headers.authorization"],
  },
  disableRequestLogging: true,
  bodyLimit: 512 * 1024,
});
await app.register(cookie);
await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
const publicOrigin = process.env.PUBLIC_ORIGIN;
app.addHook("onRequest", async (req, reply) => {
  reply
    .header("X-Content-Type-Options", "nosniff")
    .header("Referrer-Policy", "same-origin")
    .header("X-Frame-Options", "DENY");
  if (req.url.startsWith("/api")) reply.header("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.origin;
    const allowed = publicOrigin || `${req.protocol}://${req.headers.host}`;
    if (
      (origin && origin !== allowed) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return reply.code(403).send({ error: "请求来源不匹配，请使用同源页面" });
  }
});
app.setErrorHandler((error: any, req, reply) => {
  if (error instanceof z.ZodError)
    return reply
      .code(400)
      .send({ error: error.issues.map((i: any) => i.message).join("；") });
  if (error.statusCode && error.statusCode < 500)
    return reply.code(error.statusCode).send({ error: error.message });
  req.log.error(
    { err: { name: error.name, code: error.code } },
    "request failed",
  );
  reply.code(500).send({ error: "服务器暂时无法完成请求" });
});
async function workspace(req: any): Promise<string> {
  const token = req.cookies.kousou_session;
  if (!token)
    throw Object.assign(new Error("请创建或恢复工作区"), { statusCode: 401 });
  const rows =
    await sql`select workspace_id from sessions where token_hash=${digest(token)} and expires_at>now()`;
  if (!rows.length)
    throw Object.assign(new Error("会话已过期，请使用恢复密钥登录"), {
      statusCode: 401,
    });
  return rows[0].workspace_id;
}
async function setSession(reply: any, workspaceId: string) {
  const token = randomBytes(32).toString("base64url");
  await sql`insert into sessions(token_hash,workspace_id,expires_at) values(${digest(token)},${workspaceId},now()+interval '30 days')`;
  reply.setCookie("kousou_session", token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 30 * 86400,
  });
}
const uuid = z.string().uuid();
const pathId = (req: any) => uuid.parse(req.params.id);
app.get("/api/v1/health/live", async () => ({
  ok: true,
  engineVersion: ENGINE_VERSION,
}));
app.get("/api/v1/health/ready", async () => {
  const rows = await sql`select version from schema_versions where version=1`;
  if (!rows.length) throw new Error("Schema not ready");
  return { ok: true, engineVersion: ENGINE_VERSION };
});
app.get("/api/v1/session", async (req) => ({
  workspaceId: await workspace(req),
  engineVersion: ENGINE_VERSION,
}));
app.post(
  "/api/v1/workspaces",
  { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } },
  async (req, reply) => {
    const id = randomUUID(),
      key = randomBytes(24).toString("base64url");
    await sql`insert into workspaces(id,key_hash) values(${id},${digest(key)})`;
    await setSession(reply, id);
    return { workspaceId: id, recoveryKey: key, engineVersion: ENGINE_VERSION };
  },
);
app.post(
  "/api/v1/sessions/recover",
  { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
  async (req, reply) => {
    const body = z.object({ key: z.string().min(10).max(200) }).parse(req.body);
    const rows =
      await sql`select id from workspaces where key_hash=${digest(body.key.trim())}`;
    if (!rows.length) return reply.code(401).send({ error: "恢复密钥不正确" });
    await setSession(reply, rows[0].id);
    return { workspaceId: rows[0].id, engineVersion: ENGINE_VERSION };
  },
);
app.post("/api/v1/workspace-keys/rotate", async (req, reply) => {
  const w = await workspace(req),
    key = randomBytes(24).toString("base64url");
  await sql.begin(async (tx) => {
    await tx`update workspaces set key_hash=${digest(key)} where id=${w}`;
    await tx`delete from sessions where workspace_id=${w}`;
  });
  await setSession(reply, w);
  return { recoveryKey: key };
});
app.post("/api/v1/sessions/logout", async (req, reply) => {
  if (req.cookies.kousou_session)
    await sql`delete from sessions where token_hash=${digest(req.cookies.kousou_session)}`;
  reply.clearCookie("kousou_session", { path: "/" });
  return { ok: true };
});
app.get("/api/v1/plans", async (req) => {
  const w = await workspace(req);
  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.workspaceId, w))
    .orderBy(desc(plans.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.document.title,
    revision: r.revision,
    updatedAt: r.updatedAt,
  }));
});
app.post("/api/v1/plans", async (req) => {
  const w = await workspace(req);
  const body = z
    .object({
      example: z.boolean().optional(),
      document: planSchema.optional(),
    })
    .parse(req.body || {});
  const document =
    body.document || (body.example ? examplePlan() : emptyPlan());
  const id = randomUUID();
  const rows =
    await sql`insert into checkout_plans(id,workspace_id,document) values(${id},${w},${JSON.stringify(document)}::jsonb) returning id,revision,document`;
  return rows[0];
});
app.get("/api/v1/plans/:id", async (req, reply) => {
  const rows = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.id, pathId(req)),
        eq(plans.workspaceId, await workspace(req)),
      ),
    );
  if (!rows.length) return reply.code(404).send({ error: "方案不存在" });
  return rows[0];
});
app.put("/api/v1/plans/:id", async (req, reply) => {
  const w = await workspace(req),
    id = pathId(req),
    b = saveSchema.parse(req.body);
  const rows =
    await sql`update checkout_plans set document=${JSON.stringify(b.document)}::jsonb,revision=revision+1,updated_at=now() where id=${id} and workspace_id=${w} and revision=${b.expectedRevision} returning id,revision`;
  if (!rows.length)
    return reply
      .code(409)
      .send({ error: "方案已被其他页面修改，请重新加载或另存副本" });
  return rows[0];
});
app.delete("/api/v1/plans/:id", async (req, reply) => {
  const w = await workspace(req),
    id = pathId(req);
  const b = z
    .object({ expectedRevision: z.number().int().positive() })
    .parse(req.body);
  const rows =
    await sql`delete from checkout_plans where id=${id} and workspace_id=${w} and revision=${b.expectedRevision} returning id`;
  if (!rows.length)
    return reply.code(409).send({ error: "方案已变化，请重新加载后删除" });
  return { ok: true };
});
app.post("/api/v1/pricing/calculate", async (req) => {
  await workspace(req);
  return calculate(planSchema.parse(req.body));
});
app.post("/api/v1/plans/:id/snapshots", async (req, reply) => {
  const w = await workspace(req),
    id = pathId(req),
    b = z
      .object({
        expectedRevision: z.number().int().positive(),
        requestId: uuid,
      })
      .parse(req.body);
  return sql.begin(async (tx) => {
    const previous =
      await tx`select id,result,plan_id,revision from calculation_snapshots where workspace_id=${w} and request_id=${b.requestId}`;
    if (previous.length) {
      if (
        previous[0].plan_id !== id ||
        previous[0].revision !== b.expectedRevision
      )
        return reply.code(409).send({ error: "幂等请求标识已用于另一版本" });
      return previous[0];
    }
    const rows =
      await tx`select * from checkout_plans where id=${id} and workspace_id=${w} for update`;
    if (!rows.length) return reply.code(404).send({ error: "方案不存在" });
    if (rows[0].revision !== b.expectedRevision)
      return reply.code(409).send({ error: "方案已变化，请先保存最新修订" });
    const input = planSchema.parse(rows[0].document),
      result = calculate(input),
      snapshotId = randomUUID();
    const inserted = await tx`insert into calculation_snapshots(id,workspace_id,plan_id,revision,input,result,engine_version,input_hash,request_id) values(${snapshotId},${w},${id},${b.expectedRevision},${JSON.stringify(input)}::jsonb,${JSON.stringify(result)}::jsonb,${ENGINE_VERSION},${createHash("sha256").update(JSON.stringify(input)).digest("hex")},${b.requestId}) on conflict (workspace_id,request_id) do nothing returning id`;
    if (!inserted.length) {
      const existing = await tx`select id,result,plan_id,revision from calculation_snapshots where workspace_id=${w} and request_id=${b.requestId}`;
      if (existing[0].plan_id !== id || existing[0].revision !== b.expectedRevision)
        return reply.code(409).send({ error: "幂等请求标识已用于另一版本" });
      return existing[0];
    }
    return { id: snapshotId, result };
  });
});
app.get("/api/v1/plans/:id/snapshots", async (req) => {
  const w = await workspace(req),
    id = pathId(req);
  return sql`select id,revision,result,created_at from calculation_snapshots where workspace_id=${w} and plan_id=${id} order by created_at desc limit 50`;
});
app.get("/api/v1/export", async (req) => {
  const w = await workspace(req);
  const rows =
    await sql`select document from checkout_plans where workspace_id=${w}`;
  return {
    format: "kousou",
    version: 1,
    exportedAt: new Date().toISOString(),
    plans: rows.map((r) => r.document),
  };
});
const dist = resolve("apps/web/dist");
if (existsSync(dist)) {
  await app.register(staticPlugin, {
    root: dist,
    maxAge: "1d",
    setHeaders(res, path) {
      if (path.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (
      req.url.startsWith("/api/") ||
      req.url.startsWith("/assets/") ||
      req.method !== "GET"
    )
      return reply.code(404).send({ error: "Not found" });
    return reply.header("Cache-Control", "no-cache").sendFile("index.html");
  });
}
const stop = async () => {
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await app.listen({
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
});
