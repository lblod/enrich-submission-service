import { query, sparqlEscapeUri } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import enrich from './enricher';
import {
  getFileContent,
  getFileContentPhysical,
  insertTtlFile,
  updateTtlFile,
  deleteTtlFile,
} from './file-helpers';
import * as smt from '../automatic-submission-flow-tools/asfSubmissions.js';
import * as env from '../env.js';

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
export async function getSubmissionDocument(uuid) {
  const { submissionDocument, status } =
    await smt.getSubmissionDocumentInfoById(uuid);

  if (submissionDocument) {
    console.log('Status of submission document is ' + status.value);
    if (
      status.value == env.CONCEPT_STATUS ||
      status.value == env.SUBMITABLE_STATUS
    ) {
      console.log(
        'Form is in concept status. Getting harvested data and additions/removals.'
      );
      const formFile = await getFormFile(submissionDocument.value);
      const form = await calculateActiveForm(
        submissionDocument.value,
        formFile
      );
      const { meta } = await calculateMetaSnapshot(submissionDocument.value);
      const source = await getHarvestedData(submissionDocument.value);
      const additions = await getAdditions(submissionDocument.value);
      const removals = await getRemovals(submissionDocument.value);
      return new SubmissionDocument(form, meta, source, additions, removals);
    } else {
      console.log('Form is in sent status. Getting submitted form data.');
      const form = await getSubmittedForm(submissionDocument.value);
      const meta = await getSubmittedMeta(submissionDocument.value);
      const source = await getSubmittedFormData(submissionDocument.value);
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
export async function deleteSubmissionDocument(uuid) {
  const { submissionDocument, status } =
    await smt.getSubmissionDocumentInfoById(uuid);

  if (submissionDocument.value) {
    console.log('Status of submission document is ' + status);
    if (status.value == env.SENT_STATUS) {
      console.log(
        `Form with uuid ${uuid} is in sent status and can not be deleted.`
      );
    } else {
      const additionsFile = await getFileResource(
        submissionDocument.value,
        env.ADDITIONS_FILE_TYPE
      );
      const removalsFile = await getFileResource(
        submissionDocument.value,
        env.REMOVALS_FILE_TYPE
      );
      const metaFile = await getFileResource(
        submissionDocument.value,
        env.META_FILE_TYPE
      );
      const sourceFile = await getFileResource(
        submissionDocument.value,
        env.FORM_DATA_FILE_TYPE
      );

      if (additionsFile) deleteTtlFile(additionsFile);
      if (removalsFile) deleteTtlFile(removalsFile);
      if (metaFile) deleteTtlFile(metaFile);
      if (sourceFile) deleteTtlFile(sourceFile);

      deleteSubmissionDocumentResource(submissionDocument.value); //TODO: async function, deliberate no wait?
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
export async function calculateMetaSnapshot(submissionDocument) {
  const content = await enrich(submissionDocument);
  const logicalFileUri = await saveMeta(submissionDocument, content);
  return { meta: content, logicalFileUri };
}

/**
 * Calculate current active form based on the environment variable ACTIVE_FORM_FILE
 *
 * @return {string} TTL with the current form
 */
export async function calculateActiveForm(
  submissionDocument,
  formFile = env.ACTIVE_FORM_FILE
) {
  await saveForm(submissionDocument, formFile);
  return await getFileContentPhysical(formFile);
}

/*
 * Private
 */

async function saveForm(submissionDocument, formFile) {
  await updateSudo(`
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

      DELETE {
        GRAPH ?g {
          ${sparqlEscapeUri(submissionDocument)}
            dct:source ?file .
        }
      } WHERE {
        GRAPH ${sparqlEscapeUri(env.PUBLIC_FILES_GRAPH)} {
          ?file
            dct:type ${sparqlEscapeUri(env.FORM_FILE_TYPE)} .
        }
      }
      ;
      INSERT {
        GRAPH ?g {
          ${sparqlEscapeUri(submissionDocument)}
            dct:source ${sparqlEscapeUri(formFile)} .
        }
        GRAPH ${sparqlEscapeUri(env.PUBLIC_FILES_GRAPH)} {
          ${sparqlEscapeUri(formFile)}
            dct:type ${sparqlEscapeUri(env.FORM_FILE_TYPE)} .
        }
      } WHERE {
        GRAPH ?g {
          ${sparqlEscapeUri(submissionDocument)}
            a ext:SubmissionDocument .
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
async function getHarvestedData(submissionDocument) {
  const result = await query(`
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT DISTINCT ?logicalFile
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)}
          dct:source ?logicalFile .
        ?logicalFile
          dct:type <http://data.lblod.gift/concepts/harvested-data> .
      }
    }
  `);

  if (result.results.bindings.length) {
    const file = result.results.bindings[0]['logicalFile'].value;
    return await getFileContent(file);
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
  return getPart(submissionDocument, env.ADDITIONS_FILE_TYPE);
}

/**
 * Get removals on the harvested data of a submission document in TTL format.
 * Removals are created by manually editing a submission document.
 *
 * @param {string} submissionDocument URI of the submitted document to get the removals for
 * @return {string} TTL with removals for the given submission document
 */
function getRemovals(submissionDocument) {
  return getPart(submissionDocument, env.REMOVALS_FILE_TYPE);
}

/**
 * Get form used to submit a submission document in TTL format.
 *
 * @param {string} submissionDocument URI of the submitted document to get the form data for
 * @return {string} TTL with the form used to submit the document
 */
function getSubmittedForm(submissionDocument) {
  return getPartWithoutLogical(submissionDocument, env.FORM_FILE_TYPE);
}

/**
 * Get meta data of a submitted submission document in TTL format.
 * Only available for submissions that have already been submitted.
 *
 * @param {string} submissionDocument URI of the submitted document to get the form data for
 * @return {string} TTL with the meta data used to validate the form
 */
async function getSubmittedMeta(submissionDocument) {
  return getPart(submissionDocument, env.META_FILE_TYPE);
}

/**
 * Get submitted form data of a submission document in TTL format.
 * Only available for submissions that have already been submitted.
 *
 * @param {string} submissionDocument URI of the submitted document to get the form data for
 * @return {string} TTL with submitted form data
 */
async function getSubmittedFormData(submissionDocument) {
  return getPart(submissionDocument, env.FORM_DATA_FILE_TYPE);
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
  if (file) return await getFileContent(file);
}
async function getPartWithoutLogical(submissionDocument, fileType) {
  const file = await getFileResource(submissionDocument, fileType);
  if (file) return await getFileContentPhysical(file);
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

    SELECT DISTINCT ?logicalFile
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)} dct:source ?logicalFile .
      }
      ?logicalFile dct:type ${sparqlEscapeUri(fileType)} .
    }
  `);

  if (result.results.bindings.length) {
    return result.results.bindings[0]['logicalFile'].value;
  } else {
    console.log(
      `Part of type ${fileType} for submission document ${submissionDocument} not found`
    );
  }
}

/**
 * Write meta data used to fill in the form in TTL format to a file.
 *
 * @param {string} submissionDocument URI of the submitted document to write the meta data for
 * @param {string} content Meta data in TTL format
 */
function saveMeta(submissionDocument, content) {
  return savePart(submissionDocument, content, env.META_FILE_TYPE);
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

    SELECT ?logicalFile
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)}
          dct:source ?logicalFile .
        ?logicalFile
          dct:type ${sparqlEscapeUri(fileType)} .
      }
    }
  `);

  if (!result.results.bindings.length) {
    const logicalFileUri = await insertTtlFile(submissionDocument, content);
    await updateSudo(`
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

      INSERT {
        GRAPH ?g {
          ${sparqlEscapeUri(submissionDocument)}
            dct:source ${sparqlEscapeUri(logicalFileUri)} .
          ${sparqlEscapeUri(logicalFileUri)}
            dct:type ${sparqlEscapeUri(fileType)} .
        }
      } WHERE {
        GRAPH ?g {
          ${sparqlEscapeUri(submissionDocument)}
            a ext:SubmissionDocument .
        }
      }
    `);
    return logicalFileUri;
  } else {
    const logicalFile = result.results.bindings[0]['logicalFile'].value;
    await updateTtlFile(submissionDocument, logicalFile, content);
    return logicalFile;
  }
}

/**
 * Delete submission document resource
 *
 * @param {string} submissionDocument URI of the submitted document to get the related file for
 */
async function deleteSubmissionDocumentResource(submissionDocument) {
  await querySudo(`
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

/**
 * Get the form file linked to the submission document
 *
 * @param {string} submissionDocument URI of the submitted document to write the related file for
 */
async function getFormFile(submissionDocument) {
  const result = await querySudo(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT ?file
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)} dct:source ?file .
      }
      ?file dct:type ${sparqlEscapeUri(env.FORM_FILE_TYPE)} .
    }
  `);

  if (result.results.bindings.length) {
    const file = result.results.bindings[0]['file'].value;
    return file;
  } else {
    console.log(`File of type ${env.FORM_FILE_TYPE} for submission document ${submissionDocument} not found,
                 using the active form file ${env.ACTIVE_FORM_FILE}`);
    return env.ACTIVE_FORM_FILE;
  }
}
