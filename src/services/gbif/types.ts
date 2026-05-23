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

export type MatchType = 'EXACT' | 'FUZZY' | 'HIGHERORDER' | 'NONE';

/** Raw response from /species/match */
export type RawSpeciesMatch = {
  usageKey?: number;
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
  clazz?: string; // GBIF uses 'clazz' not 'class' to avoid reserved word
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

/** Raw children response from /species/{key}/children */
export type RawChildrenResponse = {
  offset?: number;
  limit?: number;
  endOfRecords?: boolean;
  count?: number;
  results?: RawSpeciesRecord[];
};

// ─── Occurrences ──────────────────────────────────────────────────────────────

export type BasisOfRecord =
  | 'HUMAN_OBSERVATION'
  | 'MACHINE_OBSERVATION'
  | 'PRESERVED_SPECIMEN'
  | 'LIVING_SPECIMEN'
  | 'MATERIAL_SAMPLE'
  | 'MATERIAL_CITATION'
  | 'OCCURRENCE'
  | 'LITERATURE';

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
  gadm?: unknown;
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
  temporalCoverages?: unknown[];
  geographicCoverages?: unknown[];
};

export type RawContact = {
  type?: string;
  firstName?: string;
  lastName?: string;
  email?: string[];
  organization?: string;
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
