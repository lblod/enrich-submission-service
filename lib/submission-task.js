import * as mu from 'mu';
import * as mas from '@lblod/mu-auth-sudo';
import * as env from '../env.js';

/**
 * Updates the state of the given task to the specified status with potential error message or resultcontainer file
 *
 * @param string taskUri URI of the task
 * @param string status URI of the new status
 * @param string or undefined URI of the error that needs to be attached
*/
export async function updateTaskStatus(taskUri, status, errorUri) {
  const taskUriSparql = mu.sparqlEscapeUri(taskUri);
  const nowSparql = mu.sparqlEscapeDateTime((new Date()).toISOString());
  const hasError = errorUri && status === env.TASK_FAILURE_STATUS;

  const statusUpdateQuery = `
    ${env.getPrefixes(['xsd', 'adms', 'dct', 'task', 'asj', 'nfo', 'mu'])}
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
          ${(status === env.TASK_SUCCESS_STATUS) ? `task:resultsContainer ?inputContainer ;` : ''}
          dct:modified ${nowSparql} .
      }
    }
    WHERE {
      GRAPH ?g {
        ${taskUriSparql}
          adms:status ?oldStatus ;
          ${(status === env.TASK_SUCCESS_STATUS) ? `task:inputContainer ?inputContainer ;` : ''}
          dct:modified ?oldModified .
      }
    }
  `;
  await mas.updateSudo(statusUpdateQuery);
}

