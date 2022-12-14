import { app, errorHandler } from 'mu';
import bodyParser from 'body-parser';
import { updateTaskStatus } from './lib/submission-task';
import {
  getSubmissionDocument,
  deleteSubmissionDocument,
  getSubmissionDocumentFromTask,
  calculateMetaSnapshot,
  SENT_STATUS,
  calculateActiveForm
} from './lib/submission-document';
import * as env from './env.js';
import { saveError } from './lib/utils.js';


function setup() {
  if (!process.env.ACTIVE_FORM_FILE) {
    throw new Error(
      "For this service to work an environment variable ACTIVE_FORM_FILE should be configured and " +
      "contain a value of the format `share://semantic-forms/20200406160856-forms.ttl`.\n" +
      "This variable is used to obtain the current form configuration.");
  }
}

setup();

app.use(bodyParser.json({ type: function(req) { return /^application\/json/.test(req.get('content-type')); } }));

app.get('/', function(req, res) {
  res.send('Hello from enrich-submission-service');
});

/*
 * DELTA HANDLING
*/
app.post('/delta', async function (req, res, next) {
  //We can already send a 200 back. The delta-notifier does not care about the result, as long as the request is closed.
  res.status(200).send().end();
  
  try {
    //Don't trust the delta-notifier, filter as best as possible. We just need the task that was created to get started.
    const actualTaskUris = req.body
      .map((changeset) => changeset.inserts)
      .filter((inserts) => inserts.length > 0)
      .flat()
      .filter((insert) => insert.predicate.value === env.OPERATION_PREDICATE)
      .filter((insert) => insert.object.value === env.ENRICH_OPERATION)
      .map((insert) => insert.subject.value);

    for (const taskUri of actualTaskUris) {
      try {
        await updateTaskStatus(taskUri, env.TASK_ONGOING_STATUS);
        
        const submissionDocument = await getSubmissionDocumentFromTask(taskUri);
        await calculateActiveForm(submissionDocument);
        const { logicalFile } = await calculateMetaSnapshot(submissionDocument);

        await updateTaskStatus(taskUri, env.TASK_SUCCESS_STATUS, undefined, logicalFile);
      }
      catch (error) {
        const message = `Something went wrong while enriching for task ${taskUri}`;
        console.error(`${message}\n`, error.message);
        console.error(error);
        const errorUri = await saveError({ message, detail: error.message, });
        await updateTaskStatus(taskUri, env.TASK_FAILURE_STATUS, errorUri);
      }
    }
  }
  catch (error) {
    const message = 'The task for enriching a submission could not even be started or finished due to an unexpected problem.';
    console.error(`${message}\n`, error.message);
    console.error(error);
    await saveError({ message, detail: error.message, });
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
app.get('/submission-documents/:uuid', async function(req, res, next) {
  const uuid = req.params.uuid;
  try {
    const submissionDocument = await getSubmissionDocument(uuid);
    return res.status(200).send(submissionDocument);
  } catch (e) {
    console.log(`Something went wrong while retrieving submission with id ${uuid}`);
    console.log(e);
    return next(e);
  }
});

/**
 * Deletes a submission form (if not already submitted) as well as the related resources
 * TODO: it seems in app-loket this is never called..
*/
app.delete('/submission-documents/:uuid', async function(req, res, next) {
  const uuid = req.params.uuid;
  try {
    const { submissionDocument, status } = await deleteSubmissionDocument(uuid);
    if (submissionDocument) {
      if (status == SENT_STATUS) {
        return res.status(409).send();
      } else {
        return res.status(200).send();
      }
    } else {
      return res.status(404).send();
    }
  } catch (e) {
    console.log(`Something went wrong while deleting submission with id ${uuid}`);
    console.log(e);
    return next(e);
  }
});

app.use(errorHandler);
