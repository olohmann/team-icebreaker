import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../src/domain/errors";
import type { SessionService } from "../../src/domain/sessionService";
import { createApiRouter, errorHandler } from "../../src/http/router";

function appWith(service: Partial<Record<keyof SessionService, ReturnType<typeof vi.fn>>>): {
  app: Express;
  service: typeof service;
} {
  const app = express();
  app.use(express.json());
  app.use("/api", createApiRouter(service as unknown as SessionService));
  app.use(errorHandler);
  return { app, service };
}

describe("POST /api/sessions", () => {
  it("creates a session and returns both links", async () => {
    const { app, service } = appWith({
      createSession: vi.fn().mockResolvedValue({ sessionId: "abc", ownerToken: "tok" }),
    });

    const res = await request(app).post("/api/sessions").send({ title: "Movies?" });

    expect(res.status).toBe(201);
    expect(service.createSession).toHaveBeenCalledWith({ title: "Movies?" });
    expect(res.body.sessionId).toBe("abc");
    expect(res.body.ownerToken).toBe("tok");
    expect(res.body.joinUrl).toContain("/join.html?s=abc");
    expect(res.body.masterUrl).toContain("/master.html?s=abc#owner=tok");
  });
});

describe("POST /api/sessions/:id/cards", () => {
  it("submits a card and returns 204", async () => {
    const { app, service } = appWith({ submitCard: vi.fn().mockResolvedValue(undefined) });

    const res = await request(app)
      .post("/api/sessions/s1/cards")
      .send({ participantId: "p1", name: "Alice", statement: "climbs" });

    expect(res.status).toBe(204);
    expect(service.submitCard).toHaveBeenCalledWith("s1", {
      participantId: "p1",
      name: "Alice",
      statement: "climbs",
    });
  });

  it("maps a validation error to 400", async () => {
    const { app } = appWith({
      submitCard: vi.fn().mockRejectedValue(new ValidationError("name is required")),
    });

    const res = await request(app).post("/api/sessions/s1/cards").send({ participantId: "p1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("name is required");
  });

  it("maps a conflict (closed submissions) to 409", async () => {
    const { app } = appWith({
      submitCard: vi.fn().mockRejectedValue(new ConflictError("Submissions are closed")),
    });

    const res = await request(app)
      .post("/api/sessions/s1/cards")
      .send({ participantId: "p1", name: "A", statement: "x" });

    expect(res.status).toBe(409);
  });
});

describe("GET /api/sessions/:id/master", () => {
  it("passes the owner token header to the service", async () => {
    const { app, service } = appWith({
      getMasterState: vi.fn().mockResolvedValue({ phase: "collect", submittedCount: 2 }),
    });

    const res = await request(app).get("/api/sessions/s1/master").set("x-owner-token", "tok");

    expect(res.status).toBe(200);
    expect(service.getMasterState).toHaveBeenCalledWith("s1", "tok");
    expect(res.body).toEqual({ phase: "collect", submittedCount: 2 });
  });

  it("maps a forbidden error to 403", async () => {
    const { app } = appWith({
      getMasterState: vi.fn().mockRejectedValue(new ForbiddenError()),
    });

    const res = await request(app).get("/api/sessions/s1/master");
    expect(res.status).toBe(403);
  });
});

describe("reveal control endpoints", () => {
  it("starts the reveal with the owner token", async () => {
    const { app, service } = appWith({ startReveal: vi.fn().mockResolvedValue(undefined) });

    const res = await request(app).post("/api/sessions/s1/reveal/start").set("x-owner-token", "tok");

    expect(res.status).toBe(204);
    expect(service.startReveal).toHaveBeenCalledWith("s1", "tok");
  });

  it("defaults an unknown step direction to next", async () => {
    const { app, service } = appWith({ stepReveal: vi.fn().mockResolvedValue(undefined) });

    await request(app)
      .post("/api/sessions/s1/reveal/step")
      .set("x-owner-token", "tok")
      .send({ direction: "sideways" });

    expect(service.stepReveal).toHaveBeenCalledWith("s1", "tok", "next");
  });

  it("passes back direction through", async () => {
    const { app, service } = appWith({ stepReveal: vi.fn().mockResolvedValue(undefined) });

    await request(app)
      .post("/api/sessions/s1/reveal/step")
      .set("x-owner-token", "tok")
      .send({ direction: "back" });

    expect(service.stepReveal).toHaveBeenCalledWith("s1", "tok", "back");
  });
});

describe("GET /api/sessions/:id/participant", () => {
  it("forwards the participant id and maps not-found to 404", async () => {
    const { app, service } = appWith({
      getParticipantState: vi.fn().mockRejectedValue(new NotFoundError()),
    });

    const res = await request(app).get("/api/sessions/missing/participant?pid=p1");

    expect(res.status).toBe(404);
    expect(service.getParticipantState).toHaveBeenCalledWith("missing", "p1");
  });
});
