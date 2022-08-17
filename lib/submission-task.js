import * as mu from 'mu';
import * as mas from '@lblod/mu-auth-sudo';
import * as env from '../env.js';

/**
 * Updates the state of the given task to the specified status
 *
 * @param string taskUri URI of the task
 * @param string status URI of the new status
*/
async function updateTaskStatus(taskUri, status) {
  const q = `
    PREFIX melding: <http://lblod.data.gift/vocabularies/automatische-melding/>
    PREFIX adms: <http://www.w3.org/ns/adms#>

    DELETE {
      GRAPH ?g {
        ${sparqlEscapeUri(taskUri)} adms:status ?status .
      }
    } WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(taskUri)} adms:status ?status .
      }
    }

    ;

    INSERT {
      GRAPH ?g {
        ${sparqlEscapeUri(taskUri)} adms:status ${sparqlEscapeUri(status)} .
      }
    } WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(taskUri)} a melding:AutomaticSubmissionTask .
      }
    }

  `;

  await mas.updateSudo(statusUpdateQuery);
}

