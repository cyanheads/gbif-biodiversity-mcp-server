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

/** Raw paginated response from /species/search */
export type RawSpeciesSearchResponse = {
  offset?: number;
  limit?: number;
  endOfRecords?: boolean;
  count?: number;
  results?: RawSpeciesRecord[];
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
 * only results, offset, limit, and endOfRecords. See issue #3.
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

/** Biological occurrence filters accepted by GBIF occurrence search. */
export type OccurrenceFilters = {
  taxonKey?: number;
  scientificName?: string;
  country?: string;
  publishingCountry?: string;
  stateProvince?: string;
  decimalLatitude?: string;
  decimalLongitude?: string;
  geometry?: string;
  year?: string;
  month?: number;
  basisOfRecord?: BasisOfRecord;
  hasCoordinate?: boolean;
  isInCluster?: boolean;
  coordinateUncertaintyInMeters?: string;
  datasetKey?: string;
  occurrenceStatus?: OccurrenceStatus;
  iucnRedListCategory?: IucnRedListCategory;
};

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

export type RawDatasetSearchResponse = {
  offset?: number;
  limit?: number;
  endOfRecords?: boolean;
  count?: number;
  results?: RawDatasetRecord[];
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
