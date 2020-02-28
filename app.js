import { app, errorHandler } from 'mu';
import bodyParser from 'body-parser';
import { getSubmissionDocument, updateSubmissionDocument } from './lib/submission-document';

app.use(bodyParser.json({ type: function(req) { return /^application\/json/.test(req.get('content-type')); } }));

app.get('/', function(req, res) {
  res.send('Hello from enrich-submission-service');
});

/*
 * DELTA HANDLING
*/

// TODO: Listen to insertions of harvested TTL file for automatic submissions tasks
//       and prepare meta TTL (calculateMetaSnapshot)

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
 * Update the additions and deletions of a submission form. The source, meta and form cannot be updated.
*/
app.put('/submission-documents/:uuid', async function(req, res, next) {
  const uuid = req.params.uuid;
  try {
    const { additions, removals } = req.body;
    await updateSubmissionDocument(uuid, { additions, removals });
    return res.status(204).send();
  } catch (e) {
    console.log(`Something went wrong while updating submission with id ${uuid}`);
    console.log(e);
    return next(e);
  }
});

app.use(errorHandler);
