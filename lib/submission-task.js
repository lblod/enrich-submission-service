import { sparqlEscapeUri } from 'mu';
import { updateSudo as update } from '@lblod/mu-auth-sudo';

const TASK_READY_FOR_ENRICHMENT_STATUS = 'http://lblod.data.gift/automatische-melding-statuses/ready-for-enrichment';
const TASK_READY_FOR_VALIDATION_STATUS = 'http://lblod.data.gift/automatische-melding-statuses/ready-for-validation';
const TASK_ONGOING_STATUS = 'http://lblod.data.gift/automatische-melding-statuses/enriching';
const TASK_SUCCESS_STATUS = 'http://lblod.data.gift/automatische-melding-statuses/success';
const TASK_FAILURE_STATUS = 'http://lblod.data.gift/automatische-melding-statuses/failure';

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

  await update(q);
}

export {
  TASK_READY_FOR_ENRICHMENT_STATUS,
  TASK_READY_FOR_VALIDATION_STATUS,
  TASK_ONGOING_STATUS,
  TASK_SUCCESS_STATUS,
  TASK_FAILURE_STATUS,
  updateTaskStatus
}
