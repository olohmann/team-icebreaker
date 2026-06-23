import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { DomainError } from "../domain/errors";
import type { SessionService } from "../domain/sessionService";

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

const wrap =
  (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch(next);

function ownerToken(req: Request): string | undefined {
  const header = req.header("x-owner-token");
  return header && header.length > 0 ? header : undefined;
}

function buildLinks(req: Request, sessionId: string, token: string) {
  const base = `${req.protocol}://${req.get("host")}`;
  return {
    joinUrl: `${base}/join.html?s=${encodeURIComponent(sessionId)}`,
    masterUrl: `${base}/master.html?s=${encodeURIComponent(sessionId)}#owner=${encodeURIComponent(token)}`,
  };
}

/** Thin HTTP adapter over the SessionService. Holds no domain logic. */
export function createApiRouter(service: SessionService): Router {
  const router = express.Router();

  router.post(
    "/sessions",
    wrap(async (req, res) => {
      const { sessionId, ownerToken: token } = await service.createSession({ title: req.body?.title });
      res.status(201).json({ sessionId, ownerToken: token, ...buildLinks(req, sessionId, token) });
    }),
  );

  router.post(
    "/sessions/:id/cards",
    wrap(async (req, res) => {
      await service.submitCard(req.params.id, {
        participantId: req.body?.participantId,
        name: req.body?.name,
        statement: req.body?.statement,
      });
      res.status(204).end();
    }),
  );

  router.get(
    "/sessions/:id/participant",
    wrap(async (req, res) => {
      const pid = typeof req.query.pid === "string" ? req.query.pid : undefined;
      res.json(await service.getParticipantState(req.params.id, pid));
    }),
  );

  router.get(
    "/sessions/:id/master",
    wrap(async (req, res) => {
      res.json(await service.getMasterState(req.params.id, ownerToken(req)));
    }),
  );

  router.post(
    "/sessions/:id/reveal/start",
    wrap(async (req, res) => {
      await service.startReveal(req.params.id, ownerToken(req));
      res.status(204).end();
    }),
  );

  router.post(
    "/sessions/:id/reveal/step",
    wrap(async (req, res) => {
      const direction = req.body?.direction === "back" ? "back" : "next";
      await service.stepReveal(req.params.id, ownerToken(req), direction);
      res.status(204).end();
    }),
  );

  router.post(
    "/sessions/:id/reveal/reset",
    wrap(async (req, res) => {
      await service.resetReveal(req.params.id, ownerToken(req));
      res.status(204).end();
    }),
  );

  return router;
}

const CODE_TO_STATUS: Record<DomainError["code"], number> = {
  not_found: 404,
  forbidden: 403,
  validation: 400,
  conflict: 409,
};

/** Maps domain errors to HTTP status codes; everything else is a 500. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof DomainError) {
    res.status(CODE_TO_STATUS[err.code]).json({ error: err.message });
    return;
  }
  // eslint-disable-next-line no-console
  console.error("Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
}
