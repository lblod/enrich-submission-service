# enrich-submission-service
Microservice to enrich a submission harvested from a published document. A submission can be enriched based on data in the triple store and by manual editing.

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
      // TODO define matching criteria
    },
    callback: {
      url: 'http://validate-submission/delta',
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
Triggers the enrichment for harvested publications.

### Manual editing of submission documents
```
GET /submission-documents/:uuid
```
Get the data for a submission form based on the submitted document uuid.

Returns an object with
* source: TTL of the harvested data (in case of a concept submission) or sent data (in case of a sent submission)
* additions: TTL containing manual added triples
* removals: TTL containing manual removed triples
* meta: TTL containing additional data to fill in the forms
* form: TTL containing the description of the forms

```
PUT /submission-forms/:uuid

expected payload: {
 additions: '',
 removals: ''
}
```
Update a submission document based on the submitted document uuid.

## Related services
The following services are also involved in the automatic processing of a submission:
* [automatic-submission-service](https://github.com/lblod/automatic-submission-service)
* [download-url-service](https://github.com/lblod/download-url-service)
* [import-submission-service](https://github.com/lblod/import-submission-service)
* [validate-submission-service](https://github.com/lblod/validate-submission-service)

