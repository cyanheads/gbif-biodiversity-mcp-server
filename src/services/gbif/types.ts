/**
 * @fileoverview Domain types for the GBIF API service.
 * @module services/gbif/types
 */

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

export type TaxonomicRank =
  | 'KINGDOM'
  | 'PHYLUM'
  | 'CLASS'
  | 'ORDER'
  | 'FAMILY'
  | 'GENUS'
  | 'SPECIES'
  | 'SUBSPECIES'
  | 'VARIETY'
  | 'FORM'
  | 'UNRANKED';

export type TaxonomicStatus =
  | 'ACCEPTED'
  | 'SYNONYM'
  | 'HOMOTYPIC_SYNONYM'
  | 'HETEROTYPIC_SYNONYM'
  | 'DOUBTFUL'
  | 'MISAPPLIED'
  | 'PROPARTE_SYNONYM';

export type MatchType = 'EXACT' | 'FUZZY' | 'HIGHERRANK' | 'NONE';

/** Raw response from /species/match */
export type RawSpeciesMatch = {
  usageKey?: number;
  /**
   * Backbone key of the accepted taxon, present only when `status` is a synonym
   * form. The endpoint carries no accompanying accepted-name string — the key is
   * the whole of what it says about the accepted taxon.
   */
  acceptedUsageKey?: number;
  scientificName?: string;
  canonicalName?: string;
  rank?: string;
  status?: string;
  confidence?: number;
  matchType?: string;
  note?: string;
  synonym?: boolean;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  kingdomKey?: number;
  phylumKey?: number;
  classKey?: number;
  orderKey?: number;
  familyKey?: number;
  genusKey?: number;
  speciesKey?: number;
};

/** Raw response from /species/{key} */
export type RawSpeciesRecord = {
  key?: number;
  nubKey?: number;
  datasetKey?: string;
  nameKey?: number;
  scientificName?: string;
  canonicalName?: string;
  vernacularName?: string;
  authorship?: string;
  nameType?: string;
  rank?: string;
  origin?: string;
  taxonomicStatus?: string;
  nomenclaturalStatus?: string[];
  numDescendants?: number;
  numOccurrences?: number;
  publishedIn?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  kingdomKey?: number;
  phylumKey?: number;
  classKey?: number;
  orderKey?: number;
  familyKey?: number;
  genusKey?: number;
  speciesKey?: number;
  acceptedKey?: number;
  accepted?: string;
  parentKey?: number;
  parent?: string;
  basionymKey?: number;
  basionym?: string;
  extinct?: boolean;
  marine?: boolean;
  freshwater?: boolean;
  terrestrial?: boolean;
};

/** One entry of a `/species/search` row's `vernacularNames[]`. */
export type RawVernacularName = {
  vernacularName?: string;
  /** ISO 639-2 code (`eng`, `fra`); GBIF omits it on many entries. */
  language?: string;
};

/**
 * One `/species/search` result row. Unlike `/species/{key}`, the row leaves the
 * singular `vernacularName` unset and carries its common names, in every language,
 * in `vernacularNames[]`; `numOccurrences` arrives as a 0 placeholder on every row.
 */
export type RawSpeciesSearchRecord = RawSpeciesRecord & {
  vernacularNames?: RawVernacularName[];
};

/** Raw paginated response from /species/search */
export type RawSpeciesSearchResponse = {
  offset?: number;
  limit?: number;
  endOfRecords?: boolean;
  count?: number;
  results?: RawSpeciesSearchRecord[];
};

/** Raw parent node from /species/{key}/parents */
export type RawParentNode = {
  key?: number;
  rank?: string;
  canonicalName?: string;
  scientificName?: string;
  nameKey?: number;
};

/**
 * Raw children response from /species/{key}/children.
 * GBIF omits any `count` field here (unlike /species/search) — the endpoint returns
 * only results, offset, limit, and endOfRecords. See issue #3. Its rows carry no
 * `numOccurrences` key either.
 */
export type RawChildrenResponse = {
  offset?: number;
  limit?: number;
  endOfRecords?: boolean;
  results?: RawSpeciesRecord[];
};

// ─── Occurrences ──────────────────────────────────────────────────────────────

/** Complete GBIF BasisOfRecord vocabulary, shared by occurrence filters. */
export const BASIS_OF_RECORD_VALUES = [
  'HUMAN_OBSERVATION',
  'MACHINE_OBSERVATION',
  'PRESERVED_SPECIMEN',
  'LIVING_SPECIMEN',
  'MATERIAL_SAMPLE',
  'MATERIAL_CITATION',
  'OCCURRENCE',
  'LITERATURE',
  'FOSSIL_SPECIMEN',
  'OBSERVATION',
  'UNKNOWN',
] as const;

export type BasisOfRecord = (typeof BASIS_OF_RECORD_VALUES)[number];

/** GBIF's own `OccurrenceStatus` vocabulary — the only two terms the API accepts. */
export type OccurrenceStatus = 'PRESENT' | 'ABSENT';

/**
 * Presence/absence filter the occurrence tools accept.
 *
 * GBIF has no upstream term meaning "either", so `ANY` is this server's
 * sentinel for one: a tool resolves it by omitting the parameter rather than
 * sending a value GBIF would reject (`/occurrence/search` answers HTTP 400
 * `Cannot parse … into a known OccurrenceStatus` for anything outside the pair).
 */
export const OCCURRENCE_STATUS_VALUES = ['PRESENT', 'ABSENT', 'ANY'] as const;

export type OccurrenceStatusFilter = (typeof OCCURRENCE_STATUS_VALUES)[number];

/**
 * IUCN Red List categories GBIF's occurrence index actually carries, taken from
 * an unscoped `facet=IUCN_RED_LIST_CATEGORY` over the whole index. `NE` (Not
 * Evaluated) is deliberately absent — it matches zero records, and an
 * unrecognized value is answered with HTTP 200 and a count of zero rather than
 * an error, so offering it would return a confident empty result.
 */
export const IUCN_RED_LIST_CATEGORY_VALUES = [
  'CR',
  'EN',
  'VU',
  'NT',
  'LC',
  'DD',
  'EX',
  'EW',
  'CD',
] as const;

export type IucnRedListCategory = (typeof IUCN_RED_LIST_CATEGORY_VALUES)[number];

/**
 * GBIF's `MediaType` vocabulary, every member of which carries indexed records.
 * `/occurrence/search` answers a value outside it with HTTP 400 `Cannot parse …
 * into a known MediaType`.
 */
export const MEDIA_TYPE_VALUES = [
  'StillImage',
  'MovingImage',
  'Sound',
  'InteractiveResource',
] as const;

export type MediaType = (typeof MEDIA_TYPE_VALUES)[number];

/**
 * Biological occurrence filters accepted by GBIF occurrence search. A member left
 * `undefined` is not sent, so a tool can hand over its parsed filter fields as-is.
 */
export type OccurrenceFilters = {
  taxonKey?: number | undefined;
  scientificName?: string | undefined;
  country?: string | undefined;
  publishingCountry?: string | undefined;
  stateProvince?: string | undefined;
  decimalLatitude?: string | undefined;
  decimalLongitude?: string | undefined;
  geometry?: string | undefined;
  year?: string | undefined;
  month?: number | undefined;
  basisOfRecord?: BasisOfRecord | undefined;
  hasCoordinate?: boolean | undefined;
  isInCluster?: boolean | undefined;
  coordinateUncertaintyInMeters?: string | undefined;
  datasetKey?: string | undefined;
  occurrenceStatus?: OccurrenceStatus | undefined;
  iucnRedListCategory?: IucnRedListCategory | undefined;
  gadmGid?: string | undefined;
  catalogNumber?: string | undefined;
  institutionCode?: string | undefined;
  recordedBy?: string | undefined;
  mediaType?: MediaType | undefined;
};

/**
 * Exhaustive over `OccurrenceFilters` by construction — `satisfies` rejects a
 * missing key as well as an extra one — so a filter cannot be added to the type
 * without a place in the table the service forwards and the tools echo.
 */
const OCCURRENCE_FILTER_TABLE = {
  taxonKey: true,
  scientificName: true,
  country: true,
  publishingCountry: true,
  stateProvince: true,
  gadmGid: true,
  decimalLatitude: true,
  decimalLongitude: true,
  geometry: true,
  year: true,
  month: true,
  basisOfRecord: true,
  hasCoordinate: true,
  isInCluster: true,
  coordinateUncertaintyInMeters: true,
  datasetKey: true,
  catalogNumber: true,
  institutionCode: true,
  recordedBy: true,
  mediaType: true,
  occurrenceStatus: true,
  iucnRedListCategory: true,
} as const satisfies Record<keyof OccurrenceFilters, true>;

/**
 * Every occurrence filter, in the order search, count, and facets forward it to
 * `/occurrence/search` and echo it in `scope`. One table for all three is what
 * keeps them answering the same population for the same arguments.
 */
export const OCCURRENCE_FILTER_KEYS = Object.keys(
  OCCURRENCE_FILTER_TABLE,
) as readonly (keyof OccurrenceFilters)[];

/** Raw occurrence record from /occurrence/search or /occurrence/{key} */
export type RawOccurrenceRecord = {
  key?: number;
  datasetKey?: string;
  occurrenceID?: string;
  kingdomKey?: number;
  phylumKey?: number;
  classKey?: number;
  orderKey?: number;
  familyKey?: number;
  genusKey?: number;
  speciesKey?: number;
  taxonKey?: number;
  scientificName?: string;
  canonicalName?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  genericName?: string;
  specificEpithet?: string;
  taxonRank?: string;
  taxonomicStatus?: string;
  decimalLatitude?: number;
  decimalLongitude?: number;
  coordinateUncertaintyInMeters?: number;
  coordinatePrecision?: number;
  continent?: string;
  stateProvince?: string;
  country?: string;
  countryCode?: string;
  locality?: string;
  publishingCountry?: string;
  elevation?: number;
  elevationAccuracy?: number;
  depth?: number;
  eventDate?: string;
  eventTime?: string;
  year?: number;
  month?: number;
  day?: number;
  basisOfRecord?: string;
  occurrenceStatus?: string;
  institutionCode?: string;
  collectionCode?: string;
  catalogNumber?: string;
  recordNumber?: string;
  identifiedBy?: string;
  recordedBy?: string;
  individualCount?: number;
  sex?: string;
  lifeStage?: string;
  establishmentMeans?: string;
  iucnRedListCategory?: string;
  datasetName?: string;
  issues?: string[];
  media?: RawMedia[];
  identifiers?: RawIdentifier[];
  gadm?: RawGadm;
};

/** A single GADM administrative level — stable GID plus the area name. */
export type RawGadmLevel = {
  gid?: string;
  name?: string;
};

/** GADM administrative geography nested on an occurrence. GBIF's index stops at level3. */
export type RawGadm = {
  level0?: RawGadmLevel;
  level1?: RawGadmLevel;
  level2?: RawGadmLevel;
  level3?: RawGadmLevel;
};

export type RawMedia = {
  type?: string;
  format?: string;
  identifier?: string;
  title?: string;
  description?: string;
  license?: string;
  rightsHolder?: string;
  publisher?: string;
  references?: string;
  created?: string;
};

export type RawIdentifier = {
  type?: string;
  identifier?: string;
};

/** Raw search response from /occurrence/search */
export type RawOccurrenceSearchResponse = {
  offset?: number;
  limit?: number;
  endOfRecords?: boolean;
  count?: number;
  results?: RawOccurrenceRecord[];
  facets?: RawFacet[];
};

export type RawFacet = {
  field?: string;
  counts?: Array<{
    name?: string;
    count?: number;
  }>;
};

/**
 * What a facet bucket key identifies, and so where its label is read: a backbone
 * taxon key resolves through `/species/{key}` to its `canonicalName`, a dataset
 * UUID through `/dataset/{key}` to its `title`. A facet response carries only
 * `name` and `count`, and GBIF has no multi-key lookup for either.
 */
export type FacetLabelKind = 'taxon' | 'dataset';

// ─── Datasets ─────────────────────────────────────────────────────────────────

export type RawDatasetRecord = {
  key?: string;
  doi?: string;
  type?: string;
  title?: string;
  description?: string;
  citation?: {
    text?: string;
    identifier?: string;
  };
  license?: string;
  publishingOrganizationKey?: string;
  publishingCountry?: string;
  hostingOrganizationKey?: string;
  installationKey?: string;
  numConstituents?: number;
  numRecords?: number;
  recordCount?: number;
  createdBy?: string;
  modifiedBy?: string;
  created?: string;
  modified?: string;
  deleted?: string;
  contacts?: RawContact[];
  temporalCoverages?: RawTemporalCoverage[];
  geographicCoverages?: RawGeographicCoverage[];
};

export type RawContact = {
  type?: string;
  firstName?: string;
  lastName?: string;
  email?: string[];
  organization?: string;
};

/** GBIF temporal coverage variants; unknown discriminator values remain visible to projection. */
export type RawTemporalCoverage = {
  '@type'?: string;
  start?: string;
  end?: string;
  date?: string;
  period?: string;
  type?: string;
};

/** A geographic coverage entry on a dataset. */
export type RawGeographicCoverage = {
  description?: string;
};

/** A `/dataset/search` row, which names the publishing organization; `/dataset/{key}` carries its key only. */
export type RawDatasetSearchRecord = RawDatasetRecord & {
  publishingOrganizationTitle?: string;
};

export type RawDatasetSearchResponse = {
  offset?: number;
  limit?: number;
  endOfRecords?: boolean;
  count?: number;
  results?: RawDatasetSearchRecord[];
};

// ─── Organizations/Publishers ─────────────────────────────────────────────────

export type RawOrganizationRecord = {
  key?: string;
  title?: string;
  description?: string;
  country?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  endorsingNodeKey?: string;
  endorsementApproved?: boolean;
  contacts?: RawContact[];
};

export type RawOrganizationSearchResponse = {
  offset?: number;
  limit?: number;
  endOfRecords?: boolean;
  count?: number;
  results?: RawOrganizationRecord[];
};
