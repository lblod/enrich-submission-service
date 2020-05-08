# enrich-submission-service
Microservice to enrich a submission harvested from a published document. A submission can be enriched with data from the triple store.

## Getting started
### Add the service to a stack
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

## Reference
### API
#### Delta handling (automatic submissions)
```
POST /delta
```
Triggers the enrichment for harvested publications. I.e. associates the current active form to the submission and prepares a meta TTL containing data from the store that is required to fill in and validate the form.

#### Retrieval of submission document to render as a form
```
GET /submission-documents/:uuid
```
Get the data for a submission form based on the submitted document uuid.

Returns an object with
* source: TTL of the harvested data (in case of a concept submission) or sent data (in case of a sent submission)
* additions: TTL containing manually added triples
* removals: TTL containing manually removed triples
* meta: TTL containing additional data to fill in and validate the forms. The TTL is a snapshot of the current meta data at the moment of the request. It may change over time as long as the submission is in concept state.
* form: TTL containing the description of the forms. The form is the current active form at the moment of the request. It may change over time as long as the submission is in concept state.


#### Manual deletion of submission document
```
DELETE /submission-documents/:uuid
```
Deletes the data and related files on disk for a submission form based on the submitted document uuid.

### Model
#### Automatic submission task
A resource describing the status and progress of the processing of an automatic submission.

##### Class
`melding:AutomaticSubmissionTask`

##### Properties
The model is specified in the [README of the automatic submission service](https://github.com/lblod/automatic-submission-service#model).
___
#### Automatic submission task statuses
Once the enrichment process starts, the status of the automatic submission task is updated to http://lblod.data.gift/automatische-melding-statuses/enriching.

On successful completion, the status of the automatic submission task is updated to http://lblod.data.gift/automatische-melding-statuses/ready-for-validation.

On failure, the status is updated to http://lblod.data.gift/automatische-melding-statuses/failure.
___
#### Submitted document
##### Class
`foaf:Document` (and `ext:SubmissionDocument`)

##### Properties
| Name   | Predicate    | Range                | Definition                                                                                                                                   |
|--------|--------------|----------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| source | `dct:source` | `nfo:FileDataObject` | TTL files containing data about the submitted document. The TTL files have different types (harvested data, additions, removals, meta, form) |

___
#### Turtle file
TTL file containing triples used to fill in a form.

##### Class
`nfo:FileDataObject`

##### Properties
| Name | Predicate    | Range                | Definition                                                                                                                                   |
|------|--------------|----------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| type | `dct:type` | `nfo:FileDataObject` | TTL files containing data about the submitted document. The TTL files have different types (harvested data, additions, removals, meta, form) |

Additional properties are specified in the model of the [file service](https://github.com/mu-semtech/file-service#resources).

Possible values of the file type are:
* http://data.lblod.gift/concepts/form-file-type: file containing the semantic form description
* http://data.lblod.gift/concepts/form-data-file-type: file containing the harvested data
* http://data.lblod.gift/concepts/additions-file-type: file containing manually added triples
* http://data.lblod.gift/concepts/removals-file-type: file containing manually removed triples

## Related services
The following services are also involved in the automatic processing of a submission:
* [automatic-submission-service](https://github.com/lblod/automatic-submission-service)
* [download-url-service](https://github.com/lblod/download-url-service)
* [import-submission-service](https://github.com/lblod/import-submission-service)
* [validate-submission-service](https://github.com/lblod/validate-submission-service)
* [toezicht-flattened-form-data-generator](https://github.com/lblod/toezicht-flattened-form-data-generator)
