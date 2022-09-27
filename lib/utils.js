import * as mas from '@lblod/mu-auth-sudo';
import * as mu from 'mu';
import * as env from '../env.js';

export async function saveError({message, detail, reference}) {
  if (!message)
    throw 'Error needs a message describing what went wrong.';
  const id = mu.uuid();
  const uri = `http://data.lblod.info/errors/${id}`;
  const referenceLink = reference ? `dct:references ${mu.sparqlEscapeUri(reference)} ;` : '';
  const detailLink =  detail ? `oslc:largePreview ${mu.sparqlEscapeString(detail)} ;` : '';
  const q = `
    PREFIX mu:   <http://mu.semte.ch/vocabularies/core/>
    PREFIX oslc: <http://open-services.net/ns/core#>
    PREFIX dct:  <http://purl.org/dc/terms/>
    PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>

    INSERT DATA {
      GRAPH <http://mu.semte.ch/graphs/error> {
        ${mu.sparqlEscapeUri(uri)}
          a oslc:Error ;
          mu:uuid ${mu.sparqlEscapeString(id)} ;
          dct:subject ${mu.sparqlEscapeString('Automatic Submission Service')} ;
          oslc:message ${mu.sparqlEscapeString(message)} ;
          dct:created ${mu.sparqlEscapeDateTime(new Date().toISOString())} ;
          ${referenceLink}
          ${detailLink}
          dct:creator ${mu.sparqlEscapeUri(env.CREATOR)} .
      }
    }
   `;
  try {
    await mas.updateSudo(q);
    return uri;
  }
  catch (e) {
    console.warn(`[WARN] Something went wrong while trying to store an error.\nMessage: ${e}\nQuery: ${q}`);
  }
}

