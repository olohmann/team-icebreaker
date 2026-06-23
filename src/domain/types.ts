export type Phase = "collect" | "reveal";

export interface Card {
  participantId: string;
  name: string;
  statement: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  sessionId: string;
  ownerToken: string;
  title?: string;
  phase: Phase;
  /** participantIds in the fixed random order chosen when the reveal starts. */
  revealOrder: string[];
  /** 0 = nothing revealed; card i exposes its statement at 2i+1 and name at 2i+2. */
  revealStep: number;
  createdAt: string;
}

export interface SessionWithCards {
  session: Session;
  cards: Card[];
}

export interface RevealUpdate {
  phase: Phase;
  revealOrder: string[];
  revealStep: number;
}

/** What the master screen is allowed to see during the reveal phase. */
export interface RevealView {
  totalCards: number;
  step: number;
  /** 0-based index of the current card in revealOrder, or -1 before the first step. */
  index: number;
  statement: string | null;
  name: string | null;
  done: boolean;
}

export type MasterState =
  | { phase: "collect"; title?: string; submittedCount: number }
  | ({ phase: "reveal"; title?: string } & RevealView);

export interface ParticipantState {
  phase: Phase;
  submissionsOpen: boolean;
  title?: string;
  card?: Pick<Card, "name" | "statement">;
}
