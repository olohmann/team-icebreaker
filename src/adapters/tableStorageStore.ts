import { odata, RestError, TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type { SessionStore } from "../domain/ports";
import type { Card, RevealUpdate, Session } from "../domain/types";

const SESSION_ROW = "session";
const CARD_PREFIX = "card_";
const AZURITE_DEV_CONNECTION =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;" +
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMA==;" +
  "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";

/** Expands the Azurite shortcut the Tables SDK does not understand natively. */
export function resolveConnectionString(raw: string): string {
  return raw.trim() === "UseDevelopmentStorage=true" ? AZURITE_DEV_CONNECTION : raw;
}

interface MetaEntity {
  partitionKey: string;
  rowKey: string;
  ownerToken: string;
  title?: string;
  phase: string;
  revealOrder: string;
  revealStep: number;
  createdAt: string;
}

interface CardEntity {
  partitionKey: string;
  rowKey: string;
  participantId: string;
  name: string;
  statement: string;
  createdAt: string;
  updatedAt: string;
}

/** SessionStore backed by Azure Table Storage (or the Azurite emulator). */
export class TableStorageSessionStore implements SessionStore {
  private constructor(private readonly client: TableClient) {}

  static async create(connectionString: string, tableName = "Icebreaker"): Promise<TableStorageSessionStore> {
    const resolved = resolveConnectionString(connectionString);
    const client = TableClient.fromConnectionString(resolved, tableName, {
      allowInsecureConnection: resolved.startsWith("http://") || resolved.includes("http://"),
    });
    await ensureTable(client);
    return new TableStorageSessionStore(client);
  }

  /**
   * Builds a store that authenticates with Microsoft Entra ID (managed identity
   * in Azure, developer credentials locally) instead of a shared account key.
   * Required when the storage account disallows key-based authentication.
   */
  static async createWithCredential(
    accountUrl: string,
    tableName = "Icebreaker",
  ): Promise<TableStorageSessionStore> {
    const client = new TableClient(accountUrl, tableName, new DefaultAzureCredential());
    await ensureTable(client);
    return new TableStorageSessionStore(client);
  }

  async createSession(session: Session): Promise<void> {
    await this.client.upsertEntity(toMetaEntity(session), "Replace");
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    try {
      const entity = await this.client.getEntity<MetaEntity>(sessionId, SESSION_ROW);
      return fromMetaEntity(entity);
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async getCard(sessionId: string, participantId: string): Promise<Card | undefined> {
    try {
      const entity = await this.client.getEntity<CardEntity>(sessionId, cardRowKey(participantId));
      return fromCardEntity(entity);
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async listCards(sessionId: string): Promise<Card[]> {
    const cards: Card[] = [];
    const entities = this.client.listEntities<CardEntity>({
      queryOptions: { filter: odata`PartitionKey eq ${sessionId}` },
    });
    for await (const entity of entities) {
      if (typeof entity.rowKey === "string" && entity.rowKey.startsWith(CARD_PREFIX)) {
        cards.push(fromCardEntity(entity));
      }
    }
    return cards;
  }

  async countCards(sessionId: string): Promise<number> {
    return (await this.listCards(sessionId)).length;
  }

  async upsertCard(sessionId: string, card: Card): Promise<void> {
    await this.client.upsertEntity(toCardEntity(sessionId, card), "Replace");
  }

  async updateReveal(sessionId: string, update: RevealUpdate): Promise<void> {
    await this.client.updateEntity(
      {
        partitionKey: sessionId,
        rowKey: SESSION_ROW,
        phase: update.phase,
        revealOrder: JSON.stringify(update.revealOrder),
        revealStep: update.revealStep,
      },
      "Merge",
    );
  }
}

async function ensureTable(client: TableClient): Promise<void> {
  try {
    await client.createTable();
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 409) return; // already exists
    throw err;
  }
}

function cardRowKey(participantId: string): string {
  return `${CARD_PREFIX}${participantId}`;
}

function toMetaEntity(session: Session): MetaEntity {
  const entity: MetaEntity = {
    partitionKey: session.sessionId,
    rowKey: SESSION_ROW,
    ownerToken: session.ownerToken,
    phase: session.phase,
    revealOrder: JSON.stringify(session.revealOrder),
    revealStep: session.revealStep,
    createdAt: session.createdAt,
  };
  if (session.title !== undefined) entity.title = session.title;
  return entity;
}

function fromMetaEntity(entity: MetaEntity): Session {
  return {
    sessionId: entity.partitionKey,
    ownerToken: entity.ownerToken,
    title: entity.title,
    phase: entity.phase === "reveal" ? "reveal" : "collect",
    revealOrder: parseOrder(entity.revealOrder),
    revealStep: typeof entity.revealStep === "number" ? entity.revealStep : 0,
    createdAt: entity.createdAt,
  };
}

function toCardEntity(sessionId: string, card: Card): CardEntity {
  return {
    partitionKey: sessionId,
    rowKey: cardRowKey(card.participantId),
    participantId: card.participantId,
    name: card.name,
    statement: card.statement,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

function fromCardEntity(entity: CardEntity): Card {
  return {
    participantId: entity.participantId,
    name: entity.name,
    statement: entity.statement,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function parseOrder(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 404;
}
