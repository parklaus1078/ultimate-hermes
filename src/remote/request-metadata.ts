import { isIP } from "node:net";
import type express from "express";

export function boundedHeader(req: express.Request, name: string, maxLength: number): string | null {
  const value = req.header(name)?.trim();
  return value ? value.slice(0, maxLength) : null;
}

function validIp(value: string | undefined | null): string | null {
  const candidate = value?.trim();
  return candidate && isIP(candidate) ? candidate : null;
}

export function requestAddresses(req: express.Request): {
  sourceIp: string | null;
  socketIp: string | null;
  forwardedFor: string | null;
} {
  const socketIp = validIp(req.socket.remoteAddress)?.slice(0, 100) ?? null;
  const proxyAwareIp = validIp(req.ip)?.slice(0, 100) ?? null;
  return {
    sourceIp: proxyAwareIp ?? socketIp,
    socketIp,
    forwardedFor: boundedHeader(req, "x-forwarded-for", 500)
  };
}
