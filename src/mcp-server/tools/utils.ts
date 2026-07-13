/**
 * @fileoverview Shared utilities for tool definitions.
 * @module mcp-server/tools/utils
 */

import type {
  RawContact,
  RawGeographicCoverage,
  RawTemporalCoverage,
} from '@/services/gbif/types.js';

/**
 * Project raw dataset contacts to a `limit`-capped, compact list plus total/returned counts.
 * Shared by `gbif_get_dataset` (caller-supplied `contactLimit`) and the `gbif://dataset/{key}`
 * resource (fixed cap). `contactsTotal`/`contactsReturned` are included only when the dataset
 * has any contacts, so callers can spread the result directly into their output object.
 */
export function projectContacts(raw: RawContact[] | undefined, limit: number) {
  const all = raw ?? [];
  const contacts = all.slice(0, limit).map((c) => ({
    type: c.type,
    firstName: c.firstName,
    lastName: c.lastName,
    organization: c.organization,
    email: c.email?.length ? c.email : undefined,
  }));
  return {
    contacts: contacts.length ? contacts : undefined,
    ...(all.length > 0 && { contactsTotal: all.length, contactsReturned: contacts.length }),
  };
}

/**
 * Project raw dataset temporal coverages to compact `{ start, end }` ranges, keeping only
 * entries that carry at least one bound (GBIF also emits verbatim/single-date shapes we skip).
 * Returns undefined when nothing survives, so the field is omitted rather than empty.
 */
export function compactTemporalCoverages(raw: RawTemporalCoverage[] | undefined) {
  const ranges = (raw ?? [])
    .map((t) => ({ start: t.start, end: t.end }))
    .filter((t) => t.start || t.end);
  return ranges.length ? ranges : undefined;
}

/**
 * Project raw dataset geographic coverages to compact `{ description }` entries, keeping only
 * those that carry a description. Returns undefined when nothing survives.
 */
export function compactGeographicCoverages(raw: RawGeographicCoverage[] | undefined) {
  const entries = (raw ?? [])
    .map((g) => ({ description: g.description }))
    .filter((g) => g.description);
  return entries.length ? entries : undefined;
}

/** Strip HTML tags and decode common entities. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#61;/g, '=')
    .replace(/&#43;/g, '+')
    .replace(/\s+/g, ' ')
    .trim();
}
