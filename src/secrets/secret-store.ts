export type SecretStore = {
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, value: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
  describe(): string;
};

export function envName(service: string, account: string): string {
  return `HERMES_SECRET_${service}_${account}`.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
}
