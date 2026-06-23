import type { Clock } from "../domain/ports";

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}
