export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "rate_limit" | "upstream" | "not_found" | "config",
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
