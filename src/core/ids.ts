import { randomBytes } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(time: number): string {
  let value = time;
  let output = "";
  for (let i = 0; i < 10; i += 1) {
    output = ENCODING[value % 32]! + output;
    value = Math.floor(value / 32);
  }
  return output;
}

function encodeRandom(bytes: Buffer): string {
  let output = "";
  for (const byte of bytes) {
    output += ENCODING[byte % 32]!;
  }
  return output.padEnd(16, "0").slice(0, 16);
}

export function createHermesId(prefix = "hme"): string {
  return `${prefix}_${encodeTime(Date.now()).toLowerCase()}${encodeRandom(randomBytes(16)).toLowerCase()}`;
}

export function createEventId(): string {
  return createHermesId("evt");
}

export function createSourceId(): string {
  return createHermesId("src");
}

export function createEntityId(): string {
  return createHermesId("ent");
}

export function createRunId(): string {
  return createHermesId("run");
}

export function createApprovalId(): string {
  return createHermesId("apr");
}
