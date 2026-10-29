import { authed, db, json } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { getCredentialPreview, issueCredential } from "@/server/services/credentials";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";

type P = { id: string };

export const GET = authed<P>(async ({ actor, ctx, params }) => {
  return json({ credential: await getCredentialPreview(db, actor, uuidParam(params.id), ctx) });
});

export const POST = authed<P>(async ({ actor, ctx, params }) => {
  await enforceRateLimit(db, "credential-issue", actor.id, RATE_RULES.credentialIssue);
  const issued = await issueCredential(db, actor, uuidParam(params.id), ctx);
  return json({ credential: { id: issued.id, issuedAt: issued.issuedAt, expiresAt: issued.expiresAt } }, { status: 201 });
});
