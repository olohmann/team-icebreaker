export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "forbidden" | "validation" | "conflict",
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Not found") {
    super(message, "not_found");
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Forbidden") {
    super(message, "forbidden");
  }
}

export class ValidationError extends DomainError {
  constructor(message = "Invalid input") {
    super(message, "validation");
  }
}

export class ConflictError extends DomainError {
  constructor(message = "Conflict") {
    super(message, "conflict");
  }
}
