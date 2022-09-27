import { querySudo as query } from '@lblod/mu-auth-sudo';
import { sparqlEscapeUri, sparqlEscapeString } from 'mu';
import {
  parse as rdflibParse,
  serialize as rdflibSerialize,
  Namespace,
  sym,
} from 'rdflib';
import * as env from '../env.js';

export const RDF = Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
export const SKOS = Namespace('http://www.w3.org/2004/02/skos/core#');
export const MANDAAT = Namespace('http://data.vlaanderen.be/ns/mandaat#');
export const BESLUIT = Namespace('http://data.vlaanderen.be/ns/besluit#');
export const XSD = Namespace('http://www.w3.org/2001/XMLSchema#');

export function serialize(store) {
  return rdflibSerialize(
    sym(env.DEFAULTGRAPH),
    store,
    undefined,
    'application/n-triples'
  );
}

export async function addTriples(store, { WHERE }) {
  const count = await countTriples({ WHERE });
  if (count > 0) {
    console.log(`Parsing 0/${count} triples`);
    let offset = 0;
    const query = `
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
      PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
      PREFIX pav: <http://purl.org/pav/>
      PREFIX dct: <http://purl.org/dc/terms/>
      
      SELECT ?s ?p ?o
      WHERE {
        GRAPH <${env.PUBLIC_GRAPH}> {
          ${WHERE}
          ?s ?p ?o .
        }
      }
      LIMIT ${env.BATCHSIZE} OFFSET %OFFSET
    `;

    while (offset < count) {
      await parseBatch(store, query, offset);
      offset = offset + env.BATCHSIZE;
      console.log(`Parsed ${offset < count ? offset : count}/${count} triples`);
    }
  }
}

async function parseBatch(store, q, offset = 0) {
  const pagedQuery = q.replace('%OFFSET', offset);
  const result = await query(pagedQuery);

  if (result.results.bindings.length) {
    const ttl = result.results.bindings
      .map((b) => selectResultToNT(b['s'], b['p'], b['o']))
      .join('\n');
    rdflibParse(ttl, store, env.DEFAULTGRAPH, 'text/turtle');
  }
}

function selectResultToNT(s, p, o) {
  const subject = sparqlEscapeUri(s.value);
  const predicate = sparqlEscapeUri(p.value);
  let obj;
  if (o.type === 'uri') {
    obj = sparqlEscapeUri(o.value);
  } else {
    obj = `${sparqlEscapeString(o.value)}`;
    if (o.datatype) obj += `^^${sparqlEscapeUri(o.datatype)}`;
  }
  return `${subject} ${predicate} ${obj} .`;
}

async function countTriples({ WHERE }) {
  const queryResult = await query(`
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX pav: <http://purl.org/pav/>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT (COUNT(*) as ?count)
    WHERE {
      GRAPH <${env.PUBLIC_GRAPH}> {
        ${WHERE}
        ?s ?p ?o .
      }
    }
  `);

  return parseInt(queryResult.results.bindings[0].count.value);
}
