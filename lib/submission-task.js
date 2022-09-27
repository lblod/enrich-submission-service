import * as mu from 'mu';
import * as mas from '@lblod/mu-auth-sudo';
import * as cts from '../automatic-submission-flow-tools/constants.js';

/**
 * Updates the state of the given task to the specified status with potential error message or resultcontainer file
 *
 * @param string taskUri URI of the task
 * @param string status URI of the new status
 * @param string or undefined URI of the error that needs to be attached
 */
export async function updateTaskStatus(
  taskUri,
  status,
  errorUri,
  logicalFileUri
) {
  const taskUriSparql = mu.sparqlEscapeUri(taskUri);
  const nowSparql = mu.sparqlEscapeDateTime(new Date().toISOString());
  const hasError = errorUri && status === cts.TASK_STATUSES.failed;

  let resultContainerTriples = '';
  let resultContainerUuid = '';
  if (logicalFileUri) {
    resultContainerUuid = mu.uuid();
    resultContainerTriples = `
      asj:${resultContainerUuid}
        a nfo:DataContainer ;
        mu:uuid ${mu.sparqlEscapeString(resultContainerUuid)} ;
        task:hasFile ${mu.sparqlEscapeUri(logicalFileUri)} .
    `;
  }
  let linkResultContainer = '';
  if (resultContainerUuid)
    linkResultContainer = `task:resultsContainer asj:${resultContainerUuid} ;`;

  const statusUpdateQuery = `
    ${cts.SPARQL_PREFIXES}
    DELETE {
      GRAPH ?g {
        ${taskUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
    INSERT {
      GRAPH ?g {
        ${taskUriSparql}
          adms:status ${mu.sparqlEscapeUri(status)} ;
          ${hasError ? `task:error ${mu.sparqlEscapeUri(errorUri)} ;` : ''}
          ${linkResultContainer}
          dct:modified ${nowSparql} .

        ${resultContainerTriples}
      }
    }
    WHERE {
      GRAPH ?g {
        ${taskUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
  `;
  await mas.updateSudo(statusUpdateQuery);
}
