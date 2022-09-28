import { app, errorHandler } from 'mu';
import bodyParser from 'body-parser';
import {
  getSubmissionDocument,
  deleteSubmissionDocument,
  calculateMetaSnapshot,
  SENT_STATUS,
  calculateActiveForm,
} from './lib/submission-document';
import * as env from './env.js';
import * as cts from './automatic-submission-flow-tools/constants.js';
import * as tsk from './automatic-submission-flow-tools/asfTasks.js';
import * as del from './automatic-submission-flow-tools/deltas.js';
import * as smt from './automatic-submission-flow-tools/asfSubmissions.js';
import * as err from './automatic-submission-flow-tools/errors.js';
import * as N3 from 'n3';
const { namedNode } = N3.DataFactory;

function setup() {
  if (!env.ACTIVE_FORM_FILE)
    throw new Error(
      'For this service to work an environment variable ACTIVE_FORM_FILE should be configured and contain a value of the format `share://semantic-forms/20200406160856-forms.ttl`.\nThis variable is used to obtain the current form configuration.'
    );
}

setup();

app.use(errorHandler);
app.use(
  bodyParser.json({
    type: function (req) {
      return /^application\/json/.test(req.get('content-type'));
    },
  })
);

app.get('/', function (req, res) {
  res.send('Hello from enrich-submission-service');
});

/*
 * DELTA HANDLING
 */
app.post('/delta', async function (req, res) {
  //We can already send a 200 back. The delta-notifier does not care about the result, as long as the request is closed.
  res.status(200).send().end();

  try {
    //Don't trust the delta-notifier, filter as best as possible. We just need the task that was created to get started.
    const actualTasks = del.getSubjects(
      req.body,
      namedNode(cts.PREDICATE_TABLE.task_operation),
      namedNode(cts.OPERATIONS.enrich)
    );

    for (const task of actualTasks) {
      try {
        await tsk.updateStatus(
          task,
          namedNode(cts.TASK_STATUSES.busy),
          namedNode(cts.SERVICES.enrichSubmission)
        );

        const submissionDocument = await smt.getSubmissionDocumentFromTask(
          task
        );
        await calculateActiveForm(submissionDocument.value);
        const { logicalFileUri } = await calculateMetaSnapshot(
          submissionDocument.value
        );

        await tsk.updateStatus(
          task,
          namedNode(cts.TASK_STATUSES.success),
          namedNode(cts.SERVICES.enrichSubmission),
          { files: [namedNode(logicalFileUri)] }
        );
      } catch (error) {
        const message = `Something went wrong while enriching for task ${task.value}`;
        console.error(`${message}\n`, error.message);
        console.error(error);
        const errorNode = await err.create(message, error.message);
        await tsk.updateStatus(
          task,
          namedNode(cts.TASK_STATUSES.failed),
          namedNode(cts.SERVICES.enrichSubmission),
          undefined,
          errorNode
        );
      }
    }
  } catch (error) {
    const message =
      'The task for enriching a submission could not even be started or finished due to an unexpected problem.';
    console.error(`${message}\n`, error.message);
    console.error(error);
    await err.create(message, error.message);
  }
});

/*
 * SUBMISSION DOCUMENT ENDPOINTS
 */

/**
 * Get data for a submission form
 *
 * @return {SubmissionForm} containing the harvested TTL, additions, deletions, meta and form
 */
app.get('/submission-documents/:uuid', async function (req, res, next) {
  const uuid = req.params.uuid;
  try {
    const submissionDocument = await getSubmissionDocument(uuid);
    return res.status(200).send(submissionDocument);
  } catch (e) {
    console.log(
      `Something went wrong while retrieving submission with id ${uuid}`
    );
    console.log(e);
    return next(e);
  }
});

/**
 * Deletes a submission form (if not already submitted) as well as the related resources
 * TODO: it seems in app-loket this is never called..
 */
app.delete('/submission-documents/:uuid', async function (req, res, next) {
  const uuid = req.params.uuid;
  try {
    const { submissionDocument, status } = await deleteSubmissionDocument(uuid);
    if (submissionDocument) {
      if (status.value == SENT_STATUS) {
        return res.status(409).send();
      } else {
        return res.status(200).send();
      }
    } else {
      return res.status(404).send();
    }
  } catch (e) {
    console.log(
      `Something went wrong while deleting submission with id ${uuid}`
    );
    console.log(e);
    return next(e);
  }
});
