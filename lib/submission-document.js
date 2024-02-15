import { query, sparqlEscapeString, sparqlEscapeUri, uuid } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import enrich from './enricher';
import { PUBLIC_FILES_GRAPH, getFileContent, getFileContentPhysical, insertTtlFile, updateTtlFile, deleteTtlFile } from './file-helpers';
import fs from 'fs-extra';
import * as env from '../env.js';
import * as config from '../config';

const CONCEPT_STATUS = 'http://lblod.data.gift/concepts/79a52da4-f491-4e2f-9374-89a13cde8ecd';
const SUBMITABLE_STATUS = 'http://lblod.data.gift/concepts/f6330856-e261-430f-b949-8e510d20d0ff';
export const SENT_STATUS = 'http://lblod.data.gift/concepts/9bd8d86d-bb10-4456-a84e-91e9507c374c';

const FORM_DATA_FILE_TYPE = 'http://data.lblod.gift/concepts/form-data-file-type';
const ADDITIONS_FILE_TYPE = 'http://data.lblod.gift/concepts/additions-file-type';
const REMOVALS_FILE_TYPE = 'http://data.lblod.gift/concepts/removals-file-type';
const META_FILE_TYPE = 'http://data.lblod.gift/concepts/meta-file-type';
const FORM_FILE_TYPE = 'http://data.lblod.gift/concepts/form-file-type';

const ACTIVE_FORM_FILE = process.env.ACTIVE_FORM_FILE;

export default class SubmissionDocument {
  constructor(form, meta, source, additions, removals) {
    this.form = form || '';
    this.meta = meta || '';
    this.source = source || '';
    this.additions = additions || '';
    this.removals = removals || '';
  }
}


/**
 * Get the submission document with the given id.
 * A submission document always contains meta and form data in TTL format.
 * In case the submission is still in concept status, the harvested data (if any), additions and removals are returned.
 * In case the submission is already submitted, the submitted data is returned.
*/
export async function getSubmissionDocument(uuid, reqState) {
  const { submissionDocument, status, organisationId } = await getSubmissionDocumentById(uuid);
  reqState.organisationId = organisationId;
  if (!reqState.submissionGraph)
    reqState.submissionGraph = config.GRAPH_TEMPLATE.replace('~ORGANIZATION_ID~', organisationId);

  if (submissionDocument) {
    console.log('Status of submission document is ' + status);
    if (status == CONCEPT_STATUS || status == SUBMITABLE_STATUS) {
      console.log('Form is in concept status. Getting harvested data and additions/removals.');
      const formFile = await getFormFile(submissionDocument, reqState);
      const form = await calculateActiveForm(submissionDocument, formFile, reqState);
      const { meta } = await calculateMetaSnapshot(submissionDocument, reqState);
      const source = await getHarvestedData(submissionDocument, reqState);
      const additions = await getAdditions(submissionDocument, reqState);
      const removals = await getRemovals(submissionDocument, reqState);
      return new SubmissionDocument(form, meta, source, additions, removals);
    } else {
      console.log('Form is in sent status. Getting submitted form data.');
      const form = await getSubmittedForm(submissionDocument, reqState);
      const meta = await getSubmittedMeta(submissionDocument, reqState);
      const source = await getSubmittedFormData(submissionDocument, reqState);
      return new SubmissionDocument(form, meta, source);
    }
  } else {
    throw new Error(`No submission document found for uuid ${uuid}`);
  }
}

/**
 * Delete the submission document with the given id and all the related files,
 * in the triplestore and on the disk.
 *
 * @return {Object} Object containing the submission document URI and submission status
*/
export async function deleteSubmissionDocument(uuid, reqState) {
  const { submissionDocument, status, organisationId } = await getSubmissionDocumentById(uuid);
  reqState.organisationId = organisationId;
  if (!reqState.submissionGraph)
    reqState.submissionGraph = config.GRAPH_TEMPLATE.replace('~ORGANIZATION_ID~', organisationId);

  if (submissionDocument) {
    console.log('Status of submission document is ' + status);
    if (status == SENT_STATUS) {
      console.log(`Form with uuid ${uuid} is in sent status and can\'t be deleted.`);
    } else {
      const additionsFile = (await getFileResource(submissionDocument, ADDITIONS_FILE_TYPE, reqState)).logicalFile;
      const removalsFile = (await getFileResource(submissionDocument, REMOVALS_FILE_TYPE, reqState)).logicalFile;
      const metaFile = (await getFileResource(submissionDocument, META_FILE_TYPE, reqState)).logicalFile;
      const sourceFile = (await getFileResource(submissionDocument, FORM_DATA_FILE_TYPE, reqState)).logicalFile;

      if (additionsFile) deleteTtlFile(additionsFile, reqState);
      if (removalsFile) deleteTtlFile(removalsFile, reqState);
      if (metaFile) deleteTtlFile(metaFile, reqState);
      if (sourceFile) deleteTtlFile(sourceFile, reqState);

      deleteSubmissionDocumentResource(submissionDocument); //TODO: async function, deliberate no wait?
    }
  } else {
    console.log(`No submission document found for uuid ${uuid}`);
  }
  return { submissionDocument, status };
}

/**
 * Calculate the current meta data for a submission document and store as a file.
 * The file is only a snapshot of the current state. It may change over time as long
 * as the submission is in concept state.
 * When the submission is submitted, the metadata snapshot is frozen and can no longer
 * be updated.
*/
export async function calculateMetaSnapshot(submissionDocument, reqState) {
  const content = await enrich(submissionDocument);
  const { logicalFile, physicalFile } = await saveMeta(submissionDocument, content, reqState);
  return { meta: content, logicalFile, physicalFile };
}

/**
 * Calculate current active form based on the environment variable ACTIVE_FORM_FILE
 *
 * @return {string} TTL with the current form
 */
export async function calculateActiveForm(submissionDocument, formFile = ACTIVE_FORM_FILE, reqState) {
    await saveForm(submissionDocument, formFile, reqState);
    return await getFileContentPhysical(formFile);
}

export async function getSubmissionDocumentFromTask(taskUri) {
  const response = await querySudo(`
    ${env.PREFIXES}
    SELECT ?submissionDocument
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(taskUri)}
          a task:Task ;
          dct:isPartOf ?job .
        ?job prov:generated ?submission .
        ?submission
          dct:subject ?submissionDocument ;
          pav:createdBy ?bestuurseenheid .
      }
      ?bestuurseenheid mu:uuid ?organisationId .
    } LIMIT 1
  `);

  const bindings = response?.results?.bindings;
  if (bindings && bindings.length > 0) {
    const binding = bindings[0];
    return binding.submissionDocument.value;
  }
}

/*
 * Private
 */

/**
 * Get the URI of the submission document with the given id and the status of the related submission
 *
 * @param {string} uuid Id of the submission document
 * @return {Object} Object containing the submission document URI and submission status
*/
async function getSubmissionDocumentById(uuid) {
  const result = await querySudo(`
    ${env.PREFIXES}
    SELECT ?submissionDocument ?status ?organisationId
    WHERE {
      GRAPH ?g {
        ?submissionDocument mu:uuid ${sparqlEscapeString(uuid)} .
        ?submission
          dct:subject ?submissionDocument ;
          adms:status ?status ;
          pav:createdBy ?bestuurseenheid .
      }
      ?bestuurseenheid mu:uuid ?organisationId .
    }
    LIMIT 1`);

  return {
    submissionDocument: result.results.bindings[0]?.submissionDocument?.value,
    status: result.results.bindings[0]?.status?.value,
    organisationId: result.results.bindings[0]?.organisationId?.value,
  };
}

async function saveForm(submissionDocument, formFile, reqState) {
  await updateSudo(`
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

      DELETE {
        GRAPH ?g {
          ${sparqlEscapeUri(submissionDocument)} dct:source ?file .
        }
      } WHERE {
        GRAPH ${sparqlEscapeUri(PUBLIC_FILES_GRAPH)} {
          ?file dct:type ${sparqlEscapeUri(FORM_FILE_TYPE)} .
        }
      }
      ;
      INSERT {
        GRAPH ${sparqlEscapeUri(reqState.submissionGraph)} {
          ${sparqlEscapeUri(submissionDocument)} dct:source ${sparqlEscapeUri(formFile)} .
        }
        GRAPH ${sparqlEscapeUri(PUBLIC_FILES_GRAPH)} {
          ${sparqlEscapeUri(formFile)} dct:type ${sparqlEscapeUri(FORM_FILE_TYPE)} .
        }
      } WHERE {
        GRAPH ${sparqlEscapeUri(reqState.submissionGraph)} {
          ${sparqlEscapeUri(submissionDocument)} a ext:SubmissionDocument .
        }
      }
    `);
}

/**
 * Get harvested data of a submission document in TTL format.
 * Only available for submissions that are submitted using the automatic submission API.
 *
 * @param {string} submissionDocument URI of the submitted document to get the harvested data for
 * @return {string} TTL with harvested data for the given submission document
*/
async function getHarvestedData(submissionDocument, reqState) {
  const result = await query(`
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
    SELECT DISTINCT ?ttlFile
    WHERE {
      GRAPH ?g {
        ?submission dct:subject ${sparqlEscapeUri(submissionDocument)} ;
                    nie:hasPart ?remoteFile .
        ?localHtmlDownload nie:dataSource ?remoteFile;
           a  <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#LocalFileDataObject>.
        ?ttlFile nie:dataSource ?localHtmlDownload .
      }
    }
  `);
  if (result.results.bindings.length) {
    const file = result.results.bindings[0]['ttlFile'].value;
    return await getFileContentPhysical(file);
  }
}

/**
 * Get additions on the harvested data of a submission document in TTL format.
 * Additions are created by manually editing a submission document.
 *
 * @param {string} submissionDocument URI of the submitted document to get the additions for
 * @return {string} TTL with additions for the given submission document
*/
function getAdditions(submissionDocument, reqState) {
  return getPart(submissionDocument, ADDITIONS_FILE_TYPE, reqState);
}

/**
 * Get removals on the harvested data of a submission document in TTL format.
 * Removals are created by manually editing a submission document.
 *
 * @param {string} submissionDocument URI of the submitted document to get the removals for
 * @return {string} TTL with removals for the given submission document
*/
function getRemovals(submissionDocument, reqState) {
  return getPart(submissionDocument, REMOVALS_FILE_TYPE, reqState);
}

/**
 * Get form used to submit a submission document in TTL format.
 *
 * @param {string} submissionDocument URI of the submitted document to get the form data for
 * @return {string} TTL with the form used to submit the document
*/
function getSubmittedForm(submissionDocument, reqState) {
  return getPart(submissionDocument, FORM_FILE_TYPE, reqState);
}

/**
 * Get meta data of a submitted submission document in TTL format.
 * Only available for submissions that have already been submitted.
 *
 * @param {string} submissionDocument URI of the submitted document to get the form data for
 * @return {string} TTL with the meta data used to validate the form
*/
async function getSubmittedMeta(submissionDocument, reqState) {
  return getPart(submissionDocument, META_FILE_TYPE, reqState);
}

/**
 * Get submitted form data of a submission document in TTL format.
 * Only available for submissions that have already been submitted.
 *
 * @param {string} submissionDocument URI of the submitted document to get the form data for
 * @return {string} TTL with submitted form data
*/
async function getSubmittedFormData(submissionDocument, reqState) {
  return getPart(submissionDocument, FORM_DATA_FILE_TYPE, reqState);
}

/**
 * Get the content of a file of the given file type that is related to the given submission document
 *
 * @param {string} submissionDocument URI of the submitted document to get the related file for
 * @param {string} fileType URI of the type of the related file
 * @return {string} Content of the related file
*/
async function getPart(submissionDocument, fileType, reqState) {
  const { logicalFile, physicalFile } = await getFileResource(submissionDocument, fileType, reqState);
  if (physicalFile) return await getFileContentPhysical(physicalFile);
}

/**
 * Get the file resource in the triplestore of the given file type that is related to the given submission document
 *
 * @param {string} submissionDocument URI of the submitted document to get the related file for
 * @param {string} fileType URI of the type of the related file
 * @return {string} File full name (path, name and extention)
*/
async function getFileResource(submissionDocument, fileType, reqState) {
  const result = await querySudo(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT DISTINCT ?logicalFile ?physicalFile
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)} dct:source ?physicalFile .
        OPTIONAL { ?physicalFile nie:dataSource ?logicalFile . }
      }
      FILTER (REGEX(STR(?g), "${reqState.organisationId}"))
      ?physicalFile dct:type ${sparqlEscapeUri(fileType)} .
    }
  `);

  if (result.results.bindings.length) {
    return {
      logicalFile: result.results.bindings[0]?.logicalFile?.value,
      physicalFile: result.results.bindings[0]?.physicalFile?.value,
    };
  } else {
    console.log(`Part of type ${fileType} for submission document ${submissionDocument} not found`);
    return { logicalFile: undefined, physicalFile: undefined };
  }
}

/**
 * Write meta data used to fill in the form in TTL format to a file.
 *
 * @param {string} submissionDocument URI of the submitted document to write the meta data for
 * @param {string} content Meta data in TTL format
*/
function saveMeta(submissionDocument, content, reqState) {
  return savePart(submissionDocument, content, META_FILE_TYPE, reqState);
}

/**
 * Write the given content to a file of the given file type that is related to the given submission document
 *
 * @param {string} submissionDocument URI of the submitted document to write the related file for
 * @param {string} content Content to write to the file
 * @param {string} fileType URI of the type of the related file
*/
async function savePart(submissionDocument, content, fileType, reqState) {
  const result = await querySudo(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT ?logicalFile ?physicalFile
    WHERE {
      GRAPH ${sparqlEscapeUri(reqState.submissionGraph)} {
        ${sparqlEscapeUri(submissionDocument)} dct:source ?physicalFile .
        ?physicalFile
          nie:dataSource ?logicalFile ;
          dct:type ${sparqlEscapeUri(fileType)} .
      }
    }
  `);

  if (!result.results.bindings.length) {
    const { logicalFile, physicalFile } = await insertTtlFile(submissionDocument, content, reqState);
    await updateSudo(`
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

      INSERT {
        GRAPH ${sparqlEscapeUri(reqState.submissionGraph)} {
          ${sparqlEscapeUri(submissionDocument)} dct:source ${sparqlEscapeUri(physicalFile)} .
          ${sparqlEscapeUri(logicalFile)} dct:type ${sparqlEscapeUri(fileType)} .
          ${sparqlEscapeUri(physicalFile)} dct:type ${sparqlEscapeUri(fileType)} .
        }
      } WHERE {
        GRAPH ${sparqlEscapeUri(reqState.submissionGraph)} {
          ${sparqlEscapeUri(submissionDocument)} a ext:SubmissionDocument .
        }
      }
    `);
    return { logicalFile, physicalFile };
  } else {
    const logicalFile = result.results.bindings[0]['logicalFile'].value;
    const physicalFile = result.results.bindings[0]['physicalFile'].value;
    await updateTtlFile(submissionDocument, logicalFile, content, reqState);
    return { logicalFile, physicalFile };
  }
}

/**
 * Delete submission document resource
 *
 * @param {string} submissionDocument URI of the submitted document to get the related file for
*/
async function deleteSubmissionDocumentResource(submissionDocument, reqState) {
  const result = await querySudo(`
    DELETE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)} ?p ?o .
      }
    }
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)} ?p ?o .
      }
      FILTER (REGEX(STR(?g), "${reqState.organisationId}"))
    }
  `);
}

/**
 * Get the form file linked to the submission document
 *
 * @param {string} submissionDocument URI of the submitted document to write the related file for
*/
async function getFormFile(submissionDocument, reqState) {
  const result = await querySudo(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT ?file
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)} dct:source ?file .
      }
      FILTER (REGEX(STR(?g), "${reqState.organisationId}"))
      ?file dct:type ${sparqlEscapeUri(FORM_FILE_TYPE)} .
    }
  `);

  if (result.results.bindings.length) {
    const file = result.results.bindings[0]['file'].value;
    return file;
  } else {
    console.log(`File of type ${FORM_FILE_TYPE} for submission document ${submissionDocument} not found,
                 using the active form file ${ACTIVE_FORM_FILE}`);
    return ACTIVE_FORM_FILE;
  }
}
