# enrich-submission-service
Microservice to enrich a submission harvested from a published document. A submission can be enriched with data from the triple store.

## Installation
Add the following snippet to your `docker-compose.yml`:

```yml
enrich-submission:
  image: lblod/enrich-submission-service
  volumes:
    - ./data/files/submissions:/share/submissions
```

The volume mounted in `/share/submissions` must contain the Turtle files containing the data harvested from the published documents. The resulting Turtle files to fill in the forms will also be written to this folder.

Configure the delta-notification service to send notifications on the `/delta` endpoint when a publication is harvested, i.e. when a harvested TTL is inserted. Add the following snippet in the delta rules configuration of your project:

```javascript
export default [
  {
    match: {
      predicate: {
        type: 'uri',
        value: 'http://www.w3.org/ns/adms#status'
      },
      object: {
        type: 'uri',
        value: 'http://lblod.data.gift/automatische-melding-statuses/ready-for-enrichment'
      }
    },
    callback: {
      url: 'http://enrich-submission/delta',
      method: 'POST'
    },
    options: {
      resourceFormat: 'v0.0.1',
      gracePeriod: 1000,
      ignoreFromSelf: true
    }
  }
]
```

## API

### Delta handling (automatic submissions)
```
POST /delta
```
Triggers the enrichment for harvested publications. I.e. prepares a meta TTL containing data from the store that is required to fill in and validate the form.

### Manual editing of submission documents
```
GET /submission-documents/:uuid
```
Get the data for a submission form based on the submitted document uuid.

Returns an object with
* source: TTL of the harvested data (in case of a concept submission) or sent data (in case of a sent submission)
* additions: TTL containing manual added triples
* removals: TTL containing manual removed triples
* meta: TTL containing additional data to fill in and validate the forms. The TTL is a snapshot of the current meta data at the moment of the request. It may change over time as long as the submission is in concept state.
* form: TTL containing the description of the forms

## Related services
The following services are also involved in the automatic processing of a submission:
* [automatic-submission-service](https://github.com/lblod/automatic-submission-service)
* [download-url-service](https://github.com/lblod/download-url-service)
* [import-submission-service](https://github.com/lblod/import-submission-service)
* [validate-submission-service](https://github.com/lblod/validate-submission-service)

