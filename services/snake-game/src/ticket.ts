/* SPDX-FileCopyrightText: 2026 PUBO contributors
 * SPDX-License-Identifier: MIT */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type Claims = { v: 1; aud: 'pubo-snake'; sub: string; name: string; jti: string; iat: number; exp: number };
export class TicketError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export class TicketVerifier {
  private readonly consumed = new Map<string, number>();
  constructor(private readonly secret: Buffer, readonly bootCutoff: number) {
    if (secret.length < 32 || secret.length > 4096) throw new Error('Ticket secret must contain 32..4096 raw bytes');
  }

  verify(ticket: unknown, now = Math.floor(Date.now() / 1000)): Claims {
    this.prune(now);
    if (typeof ticket !== 'string' || ticket.length > 2048) throw new TicketError('TICKET_INVALID');
    const parts = ticket.split('.');
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new TicketError('TICKET_INVALID');
    const encoded = parts[0]!;
    const signature = Buffer.from(parts[1]!, 'base64url');
    const expected = createHmac('sha256', this.secret).update(encoded).digest();
    if (signature.length !== expected.length || signature.toString('base64url') !== parts[1] || !timingSafeEqual(expected, signature)) throw new TicketError('TICKET_INVALID');
    let claims: Claims;
    try {
      const payload = Buffer.from(encoded, 'base64url');
      if (payload.toString('base64url') !== encoded) throw new Error('Noncanonical payload');
      claims = JSON.parse(payload.toString('utf8')) as Claims;
    } catch { throw new TicketError('TICKET_INVALID'); }
    if (!claims || typeof claims !== 'object' || claims.v !== 1 || claims.aud !== 'pubo-snake' ||
      typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub) ||
      typeof claims.name !== 'string' || claims.name.length > 256 ||
      typeof claims.jti !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(claims.jti) ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
      claims.exp <= claims.iat || claims.exp - claims.iat > 60 || claims.iat > now) throw new TicketError('TICKET_INVALID');
    if (claims.exp <= now) throw new TicketError('TICKET_EXPIRED');
    if (claims.iat <= this.bootCutoff) throw new TicketError('TICKET_BEFORE_BOOT');
    if (this.consumed.has(claims.jti)) throw new TicketError('TICKET_REPLAY');
    // Bound memory under abusive, authenticated ticket creation without weakening replay prevention.
    if (this.consumed.size >= 10_000) throw new TicketError('BUSY');
    this.consumed.set(claims.jti, claims.exp);
    return claims;
  }

  prune(now = Math.floor(Date.now() / 1000)): void {
    for (const [jti, expiry] of this.consumed) if (expiry <= now) this.consumed.delete(jti);
  }
  get size(): number { return this.consumed.size; }
}

export function signTicket(claims: Claims, secret: Buffer): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}
