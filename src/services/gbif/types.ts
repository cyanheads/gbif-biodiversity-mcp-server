/**
 * @fileoverview Domain types for the GBIF API service.
 * @module services/gbif/types
 */

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

/**
 * The GBIF Backbone Taxonomy checklist. Still the API's default taxonomy, but
 * frozen: GBIF no longer builds it. Its usage keys are integers.
 */
export const BACKBONE_CHECKLIST_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';

/**
 * The Catalogue of Life eXtended Release, GBIF's primary taxonomy. Its usage
 * keys are case-sensitive strings of upper-case letters and digits (`3WSJV`,
 * `8288`), never interchangeable with a Backbone key of the same spelling.
 */
export const COL_XR_CHECKLIST_KEY = '7ddf754f-d193-4cc9-b351-99906754a03b';

/** The two checklists GBIF accepts as `checklistKey` on species match and occurrence search. */
export const CHECKLIST_KEY_VALUES = [BACKBONE_CHECKLIST_KEY, COL_XR_CHECKLIST_KEY] as const;

export type ChecklistKey = (typeof CHECKLIST_KEY_VALUES)[number];

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
   * form. No field names the accepted taxon, `verbose=true` included, but the
   * classification fields below are the accepted taxon's: the rank field whose key
   * equals this one carries its name. Below species rank no rank field does.
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

/** One name usage in a `/v2/species/match` answer. Keys are strings in every checklist. */
export type RawChecklistUsage = {
  key?: string;
  /** Scientific name with authorship. */
  name?: string;
  /** Scientific name without authorship. */
  canonicalName?: string;
  rank?: string;
  /** Absent on `acceptedUsage`. */
  status?: string;
};

/**
 * Raw response from `/v2/species/match` — the only route that matches against a
 * checklist other than the Backbone. Requested with `scientificName` and
 * `taxonRank`: a v2 `name` answers NONE "No name given" and a v2 `rank` is ignored.
 */
export type RawChecklistSpeciesMatch = {
  /** The name usage that matched; absent on NONE. */
  usage?: RawChecklistUsage;
  /** The accepted taxon, present only when `usage` is a synonym. */
  acceptedUsage?: RawChecklistUsage;
  /**
   * The accepted taxon's classification, root first, over every rank the checklist
   * uses (DOMAIN, SUBPHYLUM, TRIBE…). A rank the checklist does not assign is absent.
   */
  classification?: { key?: string; name?: string; rank?: string }[];
  /** Holds what v1 carries at the top level; `matchType` adds VARIANT. */
  diagnostics?: { matchType?: string; confidence?: number; note?: string };
  synonym?: boolean;
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

/**
 * Presence/absence filter the occurrence tools accept: GBIF's four terms plus
 * `ANY`. GBIF has no upstream term meaning "either", so `ANY` is this server's
 * sentinel for one: a tool resolves it by omitting the parameter rather than
 * sending a value GBIF would reject (`/occurrence/search` answers HTTP 400
 * `Cannot parse … into a known OccurrenceStatus` for anything outside its terms).
 */
export const OCCURRENCE_STATUS_VALUES = [
  'PRESENT',
  'ABSENT',
  'DETECTED',
  'NOT_DETECTED',
  'ANY',
] as const;

export type OccurrenceStatusFilter = (typeof OCCURRENCE_STATUS_VALUES)[number];

/**
 * GBIF's `OccurrenceStatus` terms as its occurrence filter takes them. Records and
 * `OCCURRENCE_STATUS` facet buckets read `DETECTED` or `NOT_DETECTED`; `PRESENT`
 * and `ABSENT` are the deprecated concepts those two replaced, which the filter
 * still takes and which select the same records.
 */
export type OccurrenceStatus = Exclude<OccurrenceStatusFilter, 'ANY'>;

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
 * Every concept in GBIF's `TypeStatus` vocabulary, in GBIF's own spelling, from
 * `/v1/vocabularies/TypeStatus/concepts`. `/occurrence/search` matches a concept
 * name exactly and case-sensitively, plus every narrower concept (`Type` covers
 * every type, `Lectotype` covers `Isolectotype`), and answers any other string —
 * `holotype`, a translated label — with 200 and zero records, so the tools match
 * a caller's value against this list and send the concept's own spelling.
 *
 * Bundled rather than fetched per call: the vocabulary changes rarely, a concept
 * added later stays reachable through its broader parent, and a value missing here
 * fails loudly as `invalid_filter`. A TYPE_STATUS facet is no substitute — it lists
 * only the concepts records carry today.
 */
export const TYPE_STATUS_VALUES = [
  'Allolectotype',
  'Alloneotype',
  'Allotype',
  'Clonotype',
  'Cotype',
  'Epitype',
  'Exepitype',
  'Exholotype',
  'Exisotype',
  'Exlectotype',
  'Exneotype',
  'Exparatype',
  'Exsyntype',
  'Extype',
  'Hapantotype',
  'Holotype',
  'Homeotype',
  'Hypotype',
  'Iconotype',
  'Isoepitype',
  'Isolectotype',
  'Isoneotype',
  'Isoparatype',
  'Isosyntype',
  'Isotype',
  'Lectotype',
  'Metatype',
  'Neotype',
  'NotAType',
  'OriginalMaterial',
  'Paralectotype',
  'Paraneotype',
  'Paratopotype',
  'Paratype',
  'Plastoholotype',
  'Plastoisotype',
  'Plastolectotype',
  'Plastoneotype',
  'Plastoparatype',
  'Plastosyntype',
  'Plastotype',
  'Plesiotype',
  'SecondaryType',
  'SupplementaryType',
  'Syntype',
  'Topotype',
  'Type',
  'TypeGenus',
  'TypeSeries',
  'TypeSpecies',
  'TypeStrain',
] as const;

export type TypeStatus = (typeof TYPE_STATUS_VALUES)[number];

/**
 * Every concept in GBIF's `EstablishmentMeans` vocabulary, from
 * `/v1/vocabularies/EstablishmentMeans/concepts`, matched the way
 * `TYPE_STATUS_VALUES` is: exactly and case-sensitively upstream, a broader concept
 * covering its narrower ones (`native` covers `nativeEndemic` and
 * `nativeReintroduced`), and any other string answered with zero records.
 */
export const ESTABLISHMENT_MEANS_VALUES = [
  'native',
  'nativeEndemic',
  'nativeReintroduced',
  'introduced',
  'introducedAssistedColonisation',
  'uncertain',
  'vagrant',
] as const;

export type EstablishmentMeans = (typeof ESTABLISHMENT_MEANS_VALUES)[number];

/**
 * The license codes the occurrence index carries — an unscoped `facet=LICENSE`
 * has exactly these three buckets, summing to the whole index. GBIF also parses
 * `UNSPECIFIED` and `UNSUPPORTED`, which no record carries, and answers anything
 * else, the license URL records hold included, with HTTP 400.
 */
export const LICENSE_VALUES = ['CC0_1_0', 'CC_BY_4_0', 'CC_BY_NC_4_0'] as const;

export type License = (typeof LICENSE_VALUES)[number];

/**
 * Biological occurrence filters accepted by GBIF occurrence search, each under the
 * name the occurrence tools take it by; `OCCURRENCE_FILTER_TABLE` names the parameter
 * it is sent as. A member left `undefined` is not sent, so a tool can hand over its
 * parsed filter fields as-is.
 */
export type OccurrenceFilters = {
  taxonKey?: number | undefined;
  /**
   * A Catalogue of Life key, sent as `taxonKey`: GBIF reads `taxonKey` against the
   * checklist `checklistKey` selects, and ignores a parameter it does not know.
   */
  checklistTaxonKey?: string | undefined;
  checklistKey?: ChecklistKey | undefined;
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
  hasGeospatialIssue?: boolean | undefined;
  isInCluster?: boolean | undefined;
  coordinateUncertaintyInMeters?: string | undefined;
  datasetKey?: string | undefined;
  publishingOrg?: string | undefined;
  occurrenceStatus?: OccurrenceStatus | undefined;
  iucnRedListCategory?: IucnRedListCategory | undefined;
  gadmGid?: string | undefined;
  catalogNumber?: string | undefined;
  institutionCode?: string | undefined;
  recordedBy?: string | undefined;
  mediaType?: MediaType | undefined;
  typeStatus?: TypeStatus | undefined;
  establishmentMeans?: EstablishmentMeans | undefined;
  license?: License | undefined;
};

/**
 * Exhaustive over `OccurrenceFilters` by construction — `satisfies` rejects a
 * missing key as well as an extra one — so a filter cannot be added to the type
 * without a place in the table the service forwards and the tools echo. `true`
 * sends a filter under its own name; a string names the parameter it is sent as
 * instead, while `scope` still echoes the name the caller used.
 */
const OCCURRENCE_FILTER_TABLE = {
  taxonKey: true,
  checklistTaxonKey: 'taxonKey',
  checklistKey: true,
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
  hasGeospatialIssue: true,
  isInCluster: true,
  coordinateUncertaintyInMeters: true,
  datasetKey: true,
  publishingOrg: true,
  catalogNumber: true,
  institutionCode: true,
  recordedBy: true,
  mediaType: true,
  typeStatus: true,
  establishmentMeans: true,
  license: true,
  occurrenceStatus: true,
  iucnRedListCategory: true,
} as const satisfies Record<keyof OccurrenceFilters, true | string>;

/**
 * Every occurrence filter, in the order search, count, and facets forward it to
 * `/occurrence/search` and echo it in `scope`. One table for all three is what
 * keeps them answering the same population for the same arguments.
 */
export const OCCURRENCE_FILTER_KEYS = Object.keys(
  OCCURRENCE_FILTER_TABLE,
) as readonly (keyof OccurrenceFilters)[];

/** Each occurrence filter with the `/occurrence/search` parameter it is sent as, in the same order. */
export const OCCURRENCE_FILTER_PARAMS = Object.entries(OCCURRENCE_FILTER_TABLE).map(
  ([key, param]) => [key, param === true ? key : param],
) as readonly (readonly [keyof OccurrenceFilters, string])[];

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
  acceptedTaxonKey?: number;
  acceptedScientificName?: string;
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
  /** The tools return it as `publishingOrganizationKey`, the dataset tools' name for the same key. */
  publishingOrgKey?: string;
  /** A Creative Commons URL, not the code the `license` filter takes. */
  license?: string;
  rightsHolder?: string;
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
  typeStatus?: string;
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
 * taxon key resolves through `/species/{key}` to its `canonicalName`, a Catalogue of
 * Life taxon key through `/v2/species/match?usageKey=` to its `usage.canonicalName`,
 * a dataset UUID through `/dataset/{key}` to its `title`, an organization UUID
 * through `/organization/{key}` to its `title`, a GADM GID through
 * `/geocode/gadm/{gid}` to its `name`. A facet response carries only `name` and
 * `count`, and GBIF has no multi-key lookup for any of them.
 */
export type FacetLabelKind = 'taxon' | 'colTaxon' | 'dataset' | 'organization' | 'gadm';

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
