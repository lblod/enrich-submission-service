import process from 'node:process';

export const ACTIVE_FORM_FILE = process.env.ACTIVE_FORM_FILE || '';
export const PUBLIC_FILES_GRAPH =
  process.env.PUBLIC_FILES_GRAPH || 'http://mu.semte.ch/graphs/public';
export const PUBLIC_GRAPH =
  process.env.PUBLIC_GRAPH || 'http://mu.semte.ch/graphs/public';
export const BATCHSIZE = parseInt(process.env.CONSTRUCT_BATCH_SIZE) || 1000;

export const CONCEPT_STATUS =
  'http://lblod.data.gift/concepts/79a52da4-f491-4e2f-9374-89a13cde8ecd';
export const SUBMITABLE_STATUS =
  'http://lblod.data.gift/concepts/f6330856-e261-430f-b949-8e510d20d0ff';
export const SENT_STATUS =
  'http://lblod.data.gift/concepts/9bd8d86d-bb10-4456-a84e-91e9507c374c';

// Enrichment

export const BESTUURSORGAAN_SELECT_CONCEPT_SCHEME =
  'http://data.lblod.info/concept-schemes/481c03f0-d07f-424e-9c2b-8d4cfb141c72';
export const TYPE_DOSSIER_CONCEPT_SCHEME =
  'http://lblod.data.gift/concept-schemes/71e6455e-1204-46a6-abf4-87319f58eaa5';
export const TOEZICHT_CONCEPT_SCHEMES = [
  'http://lblod.data.gift/concept-schemes/c93ccd41-aee7-488f-86d3-038de890d05a', // reglementtype
  'http://lblod.data.gift/concept-schemes/5cecec47-ba66-4d7a-ac9d-a1e7962ca4e2', // document authenticity type
  'http://lblod.data.gift/concept-schemes/3037c4f4-1c63-43ac-bfc4-b41d098b15a6', // tax type
  'http://lblod.data.gift/concept-schemes/a995bb71-3c87-4385-a06b-a786f2fa0d16', // Decision adoption type
  'http://lblod.data.gift/concept-schemes/60d620a5-ec34-4a91-ba84-fff0813d0ccc', // Municipal road procedure
  'http://data.vlaanderen.be/id/conceptscheme/BestuursorgaanClassificatieCode',
  'http://data.vlaanderen.be/id/conceptscheme/BestuurseenheidClassificatieCode',
  'http://lblod.data.gift/concept-schemes/4e719768-d43b-4ca1-ab92-b463e15721f5', // Reporting period long term plan worship services
  'http://lblod.data.gift/concept-schemes/91655ebf-5ab7-43c4-b587-094536baf737', // Authenticity type (specific for erediensten)
];

// Submission document

export const FORM_DATA_FILE_TYPE =
  'http://data.lblod.gift/concepts/form-data-file-type';
export const ADDITIONS_FILE_TYPE =
  'http://data.lblod.gift/concepts/additions-file-type';
export const REMOVALS_FILE_TYPE =
  'http://data.lblod.gift/concepts/removals-file-type';
export const META_FILE_TYPE = 'http://data.lblod.gift/concepts/meta-file-type';
export const FORM_FILE_TYPE = 'http://data.lblod.gift/concepts/form-file-type';

// RDF helpers

export const DEFAULTGRAPH =
  'http://lblod.data.gift/services/enrich-submission-service/';
