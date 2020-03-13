import { query, sparqlEscapeString, sparqlEscapeUri, uuid } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import enrich from './enricher';
import { FILE_GRAPH, getFileContent, insertTtlFile, updateTtlFile, deleteTtlFile } from './file-helpers';
import fs from 'fs-extra';

const CONCEPT_STATUS = 'http://lblod.data.gift/concepts/79a52da4-f491-4e2f-9374-89a13cde8ecd';
const SUBMITABLE_STATUS = 'http://lblod.data.gift/concepts/f6330856-e261-430f-b949-8e510d20d0ff';
const SENT_STATUS = 'http://lblod.data.gift/concepts/9bd8d86d-bb10-4456-a84e-91e9507c374c';

const FORM_DATA_FILE_TYPE = 'http://data.lblod.gift/concepts/form-data-file-type';
const ADDITIONS_FILE_TYPE = 'http://data.lblod.gift/concepts/additions-file-type';
const REMOVALS_FILE_TYPE = 'http://data.lblod.gift/concepts/removals-file-type';
const META_FILE_TYPE = 'http://data.lblod.gift/concepts/meta-file-type';
const FORM_FILE_TYPE = 'http://data.lblod.gift/concepts/form-file-type';

const FORM_TTL = '/data/semantic-forms/form.ttl';

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
async function getSubmissionDocument(uuid) {
  const { submissionDocument, status } = await getSubmissionDocumentById(uuid);

  if (submissionDocument) {
    console.log('Status of submission document is ' + status);
    if (status == CONCEPT_STATUS || status == SUBMITABLE_STATUS) {
      console.log('Form is in concept status. Getting harvested data and additions/removals.');
      const form = await getActiveForm();
      const meta = await calculateMetaSnapshot(submissionDocument);
      const source = await getHarvestedData(submissionDocument);
      const additions = await getAdditions(submissionDocument);
      const removals = await getRemovals(submissionDocument);
      return new SubmissionDocument(form, meta, source, additions, removals);
    } else {
      console.log('Form is in sent status. Getting submitted form data.');
      const form = await getSubmittedForm(submissionDocument);
      const meta = await getSubmittedMeta(submissionDocument);
      const source = await getSubmittedFormData(submissionDocument);
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
 * @return {int} Http status of deletion
*/
async function deleteSubmissionDocument(uuid) {
  const { submissionDocument, status } = await getSubmissionDocumentById(uuid);

  if (submissionDocument) {
    console.log('Status of submission document is ' + status);
    if (status == SENT_STATUS) {
      console.log(`Form with uuid ${uuid} is in sent status and can\'t be deleted.`);
      return 409;
    } else {
      const additionsFile = await getFileResource(submissionDocument, ADDITIONS_FILE_TYPE);
      const removalsFile = await getFileResource(submissionDocument, REMOVALS_FILE_TYPE);
      const metaFile = await getFileResource(submissionDocument, META_FILE_TYPE);
      const sourceFile = await getFileResource(submissionDocument, FORM_DATA_FILE_TYPE);

      if (additionsFile) deleteTtlFile(additionsFile);
      if (removalsFile) deleteTtlFile(removalsFile);
      if (metaFile) deleteTtlFile(metaFile);
      if (sourceFile) deleteTtlFile(sourceFile);

      deleteSubmissionDocumentResource(submissionDocument);

      return 200;
    }
  } else {
    console.log(`No submission document found for uuid ${uuid}`);
    return 404;
  }
}

/**
 * Calculate the current meta data for a submission document and store as a file.
 * The file is only a snapshot of the current state. It may change over time as long
 * as the submission is in concept state.
 * When the submission is submitted, the metadata snapshot is frozen and can no longer
 * be updated.
*/
async function calculateMetaSnapshot(submissionDocument) {
  const content = await enrich(submissionDocument);
  await saveMeta(submissionDocument, content);
  return content;
}

async function getSubmissionDocumentByTask(taskUri) {
  const result = await querySudo(`
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX melding: <http://lblod.data.gift/vocabularies/automatische-melding/>
    PREFIX adms: <http://www.w3.org/ns/adms#>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT ?submissionDocument
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(taskUri)} prov:generated ?submission ;
           a melding:AutomaticSubmissionTask .
        ?submission dct:subject ?submissionDocument .
      }
    } LIMIT 1
  `);

  if (result.results.bindings.length) {
    const binding = result.results.bindings[0];
    return binding['submissionDocument'].value;
  } else {
    return null;
  }
}

export {
  getSubmissionDocument,
  deleteSubmissionDocument,
  calculateMetaSnapshot,
  getSubmissionDocumentByTask
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
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX adms: <http://www.w3.org/ns/adms#>

    SELECT ?submissionDocument ?status
    WHERE {
      GRAPH ?g {
        ?submissionDocument mu:uuid ${sparqlEscapeString(uuid)} .
        ?submission dct:subject ?submissionDocument ;
                    adms:status ?status .
      }
    }
  `);

  if (result.results.bindings.length) {
    return {
      submissionDocument: result.results.bindings[0]['submissionDocument'].value,
      status: result.results.bindings[0]['status'].value
    };
  } else {
    return {
      submissionDocument: null,
      status: null
    };
  }
}

/**
 * Get current active form
 *
 * @return {string} TTL with the current form
*/
function getActiveForm() {
  return fs.readFile(FORM_TTL, 'utf-8');
}

/**
 * Get harvested data of a submission document in TTL format.
 * Only available for submissions that are submitted using the automatic submission API.
 *
 * @param {string} submissionDocument URI of the submitted document to get the harvested data for
 * @return {string} TTL with harvested data for the given submission document
*/
async function getHarvestedData(submissionDocument) {
  const result = await query(`
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT ?ttlFile
    WHERE {
      GRAPH ?g {
        ?submission dct:subject ${sparqlEscapeUri(submissionDocument)} ;
                    nie:hasPart ?remoteFile .
      }
      GRAPH ${sparqlEscapeUri(FILE_GRAPH)} {
        ?localHtmlDownload nie:dataSource ?remoteFile .
        ?ttlFile nie:dataSource ?localHtmlDownload .
      }
    }
  `);

  if (result.results.bindings.length) {
    const file = result.results.bindings[0]['ttlFile'].value;
    return await getFileContent(file);
  } else {
    return null;
  }
}

/**
 * Get additions on the harvested data of a submission document in TTL format.
 * Additions are created by manually editing a submission document.
 *
 * @param {string} submissionDocument URI of the submitted document to get the additions for
 * @return {string} TTL with additions for the given submission document
*/
function getAdditions(submissionDocument) {
  return getPart(submissionDocument, ADDITIONS_FILE_TYPE);
}

/**
 * Get removals on the harvested data of a submission document in TTL format.
 * Removals are created by manually editing a submission document.
 *
 * @param {string} submissionDocument URI of the submitted document to get the removals for
 * @return {string} TTL with removals for the given submission document
*/
function getRemovals(submissionDocument) {
  return getPart(submissionDocument, REMOVALS_FILE_TYPE);
}

/**
 * Get form used to submit a submission document in TTL format.
 *
 * @param {string} submissionDocument URI of the submitted document to get the form data for
 * @return {string} TTL with the form used to submit the document
*/
function getSubmittedForm(submissionDocument) {
  // TODO should be the form attached to the submission once we have multiple
  return fs.readFile(FORM_TTL, 'utf-8');
}

/**
 * Get meta data of a submitted submission document in TTL format.
 * Only available for submissions that have already been submitted.
 *
 * @param {string} submissionDocument URI of the submitted document to get the form data for
 * @return {string} TTL with the meta data used to validate the form
*/
async function getSubmittedMeta(submissionDocument) {
  return getPart(submissionDocument, META_FILE_TYPE);
}

/**
 * Get submitted form data of a submission document in TTL format.
 * Only available for submissions that have already been submitted.
 *
 * @param {string} submissionDocument URI of the submitted document to get the form data for
 * @return {string} TTL with submitted form data
*/
async function getSubmittedFormData(submissionDocument) {
  return getPart(submissionDocument, FORM_DATA_FILE_TYPE);
}

/**
 * Get the content of a file of the given file type that is related to the given submission document
 *
 * @param {string} submissionDocument URI of the submitted document to get the related file for
 * @param {string} fileType URI of the type of the related file
 * @return {string} Content of the related file
*/
async function getPart(submissionDocument, fileType) {
  const file = await getFileResource(submissionDocument, fileType);
  if (file) {
    return await getFileContent(file);
  } else {
    return null;
  }
}

/**
 * Get the file resource in the triplestore of the given file type that is related to the given submission document
 *
 * @param {string} submissionDocument URI of the submitted document to get the related file for
 * @param {string} fileType URI of the type of the related file
 * @return {string} File full name (path, name and extention)
*/
async function getFileResource(submissionDocument, fileType) {
  const result = await querySudo(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT ?file
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)} dct:source ?file .
      }
      GRAPH ${sparqlEscapeUri(FILE_GRAPH)} {
        ?file dct:type ${sparqlEscapeUri(fileType)} .
      }
    }
  `);

  if (result.results.bindings.length) {
    return result.results.bindings[0]['file'].value;
  } else {
    console.log(`Part of type ${fileType} for submission document ${submissionDocument} not found`);
    return null;
  }
}

/**
 * Write meta data used to fill in the form in TTL format to a file.
 *
 * @param {string} submissionDocument URI of the submitted document to write the meta data for
 * @param {string} content Meta data in TTL format
*/
function saveMeta(submissionDocument, content) {
  return savePart(submissionDocument, content, META_FILE_TYPE);
}

/**
 * Write the given content to a file of the given file type that is related to the given submission document
 *
 * @param {string} submissionDocument URI of the submitted document to write the related file for
 * @param {string} content Content to write to the file
 * @param {string} fileType URI of the type of the related file
*/
async function savePart(submissionDocument, content, fileType) {
  const result = await querySudo(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT ?file
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)} dct:source ?file .
      }
      GRAPH ${sparqlEscapeUri(FILE_GRAPH)} {
        ?file dct:type ${sparqlEscapeUri(fileType)} .
      }
    }
  `);

  if (!result.results.bindings.length) {
    const file = await insertTtlFile(content);
    await updateSudo(`
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

      INSERT {
        GRAPH ?g {
          ${sparqlEscapeUri(submissionDocument)} dct:source ${sparqlEscapeUri(file)} .
        }
        GRAPH ${sparqlEscapeUri(FILE_GRAPH)} {
          ${sparqlEscapeUri(file)} dct:type ${sparqlEscapeUri(fileType)} .
        }
      } WHERE {
        GRAPH ?g {
          ${sparqlEscapeUri(submissionDocument)} a ext:SubmissionDocument .
        }
      }
    `);
    return file;
  } else {
    const file = result.results.bindings[0]['file'].value;
    await updateTtlFile(file, content);
    return file;
  }
}

/**
 * Delete submission document resource
 *
 * @param {string} submissionDocument URI of the submitted document to get the related file for
*/
async function deleteSubmissionDocumentResource(submissionDocument) {
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
    }
  `);
}