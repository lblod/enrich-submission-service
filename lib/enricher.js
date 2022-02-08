import {sparqlEscapeUri} from 'mu';
import {graph as rdflibStore, sym} from 'rdflib';
import {querySudo as query} from '@lblod/mu-auth-sudo';
import {defaultGraph, addTriples, RDF, SKOS, serialize} from './rdflib-helpers';

/* ENRICHTERS */
import bestuursorganenEnricher from './enrichers/bestuursorganen';

const TYPE_DOSSIER_CONCEPT_SCHEME = 'http://lblod.data.gift/concept-schemes/71e6455e-1204-46a6-abf4-87319f58eaa5';
const TOEZICHT_CONCEPT_SCHEMES = [
  'http://lblod.data.gift/concept-schemes/c93ccd41-aee7-488f-86d3-038de890d05a', // reglementtype
  'http://lblod.data.gift/concept-schemes/5cecec47-ba66-4d7a-ac9d-a1e7962ca4e2', // document authenticity type
  'http://lblod.data.gift/concept-schemes/3037c4f4-1c63-43ac-bfc4-b41d098b15a6', // tax type
  'http://lblod.data.gift/concept-schemes/a995bb71-3c87-4385-a06b-a786f2fa0d16', // Decision adoption type
  'http://lblod.data.gift/concept-schemes/60d620a5-ec34-4a91-ba84-fff0813d0ccc', // Municipal road procedure
  'http://data.vlaanderen.be/id/conceptscheme/BestuursorgaanClassificatieCode',
  'http://data.vlaanderen.be/id/conceptscheme/BestuurseenheidClassificatieCode',
];

/**
 * Enrich the harvested triples dataset with derived knowledge
 * based on the current harvested triples and the data in the triplestore.
 */
export default async function enrich(submissionDocument) {
  const store = rdflibStore();

  await constructConceptSchemes(store);
  await addRelevantDossierTypes(submissionDocument, store);
  await addUserFriendlyChartOfAccounts(store);
  await bestuursorganenEnricher(store, {subject: submissionDocument});

  return serialize(store);
}

async function constructConceptSchemes(store) {
  for (let conceptScheme of TOEZICHT_CONCEPT_SCHEMES) {
    console.log(`Adding concept scheme ${conceptScheme} to meta graph`);
    await addTriples(store, {
      WHERE: `?s skos:inScheme ${sparqlEscapeUri(conceptScheme)} .`,
    });
  }
}

async function addRelevantDossierTypes(submissionDocument, store) {
  console.log(`Adding relevant dossier types to meta graph`);
  const bestuurseenheid = await getBestuurseenheidFor(submissionDocument);
  await addTriples(store, {
    WHERE: `${sparqlEscapeUri(bestuurseenheid)} besluit:classificatie ?classificatie .
            ?s <http://lblod.data.gift/vocabularies/besluit/decidableBy> ?classificatie ;
                skos:inScheme ${sparqlEscapeUri(TYPE_DOSSIER_CONCEPT_SCHEME)} .`,
  });
}

async function addUserFriendlyChartOfAccounts(store) {
  const q = `
    SELECT DISTINCT ?entry ?scheme ?notation ?label WHERE {
      GRAPH ?g {
       ?entry a <http://www.w3.org/2004/02/skos/core#Concept>;
            <http://www.w3.org/2004/02/skos/core#inScheme> ?scheme ;
            <http://www.w3.org/2004/02/skos/core#notation> ?notation ;
            <http://www.w3.org/2004/02/skos/core#prefLabel> ?label ;
            <http://www.w3.org/2004/02/skos/core#topConceptOf> <http://lblod.data.gift/concept-schemes/b65b15ba-6755-4cd2-bd07-2c2cf3c0e4d3> .
      }
    }
  `;
  const results = await query(q);
  for (const binding of results.results.bindings) {
    const subject = binding['entry'].value;
    const scheme = binding['scheme'].value;
    const notation = binding['notation'].value;
    const label = binding['label'].value;
    const newLabel = `${notation} - ${label}`;

    store.add(sym(subject), RDF('type'),
        sym('http://www.w3.org/2004/02/skos/core#Concept'), sym(defaultGraph));
    store.add(sym(subject), SKOS('inScheme'), sym(scheme), sym(defaultGraph));
    store.add(sym(subject), SKOS('prefLabel'), newLabel, sym(defaultGraph));
  }

  return store;
}

async function getBestuurseenheidFor(submissionDocument) {
  const result = await query(`
    PREFIX pav: <http://purl.org/pav/>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT *
    WHERE {
        GRAPH ?g {
          ?submission dct:subject ${sparqlEscapeUri(submissionDocument)} ;
            pav:createdBy ?bestuurseenheid .
        }
    }
  `);

  if (result.results.bindings.length) {
    return result.results.bindings[0]['bestuurseenheid'].value;
  }
}
