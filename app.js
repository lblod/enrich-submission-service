import { app, errorHandler } from 'mu';
import bodyParser from 'body-parser';
import flatten from 'lodash.flatten';
import { TASK_READY_FOR_ENRICHMENT_STATUS, TASK_READY_FOR_VALIDATION_STATUS, TASK_ONGOING_STATUS, TASK_FAILURE_STATUS, updateTaskStatus } from './lib/submission-task';
import { getSubmissionDocument, deleteSubmissionDocument, getSubmissionDocumentByTask, calculateMetaSnapshot, SENT_STATUS } from './lib/submission-document';

app.use(bodyParser.json({ type: function(req) { return /^application\/json/.test(req.get('content-type')); } }));

app.get('/', function(req, res) {
  res.send('Hello from enrich-submission-service');
});

/*
 * DELTA HANDLING
*/
app.post('/delta', async function(req, res, next) {
  const tasks = getAutomaticSubmissionTasks(req.body);
  if (!tasks.length) {
    console.log("Delta does not contain an automatic submission task with status 'ready-for-enrichment'. Nothing should happen.");
    return res.status(204).send();
  }

  for (let task of tasks) {
    try {
      await updateTaskStatus(task, TASK_ONGOING_STATUS);
      const submissionDocument = await getSubmissionDocumentByTask(task);

      const enrich = async (submissionDocument) => {
        try {
          await calculateMetaSnapshot(submissionDocument);
          await updateTaskStatus(task, TASK_READY_FOR_VALIDATION_STATUS);
        } catch (e) {
          await updateTaskStatus(task, TASK_FAILURE_STATUS);
        }
      };

      if (submissionDocument)
        enrich(submissionDocument); // async processing
      else
        console.log(`No submission document found for task ${task}`);
    } catch (e) {
      console.log(`Something went wrong while handling deltas for automatic submission task ${task}`);
      console.log(e);
      try {
        await updateTaskStatus(task, TASK_FAILURE_STATUS);
      } catch (e) {
        console.log(`Failed to update state of task ${task} to failure state. Is the connection to the database broken?`);
      }
      return next(e);
    }
  }

  return res.status(200).send({ data: tasks });
});

/**
 * Returns the automatic submission tasks that are ready for enrichment
 * from the delta message. An empty array if there are none.
 *
 * @param Object delta Message as received from the delta notifier
*/
function getAutomaticSubmissionTasks(delta) {
  const inserts = flatten(delta.map(changeSet => changeSet.inserts));
  return inserts.filter(isTriggerTriple).map(t => t.subject.value);
}

/**
 * Returns whether the passed triple is a trigger for the enrichment process
 *
 * @param Object triple Triple as received from the delta notifier
*/
function isTriggerTriple(triple) {
  return triple.predicate.value == 'http://www.w3.org/ns/adms#status'
    && triple.object.value == TASK_READY_FOR_ENRICHMENT_STATUS;
};


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
