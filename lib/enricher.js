import * as mu from 'mu';
import * as mas from '@lblod/mu-auth-sudo';
import * as env from '../env.js';
import * as sjp from 'sparqljson-parse';
import * as cts from '../automatic-submission-flow-tools/constants.js';
import * as N3 from 'n3';
const { quad } = N3.DataFactory;

/**
 * Enrich the harvested triples dataset with derived knowledge
 * based on the current harvested triples and the data in the triplestore.
 */
export async function enrich(submissionDocument) {
  const store = new N3.Store();

  await constructConceptSchemes(store);
  await addRelevantDossierTypes(submissionDocument, store);
  await addUserFriendlyChartOfAccounts(store);
  await addBestuursorganenForBestuurseenheid(submissionDocument, store);

  const writer = new N3.Writer({ format: 'text/turtle' });
  store.forEach((quad) => writer.addQuad(quad));
  return new Promise((resolve, reject) => {
    writer.end((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

async function addTriples(store, query) {
  query = `${cts.SPARQL_PREFIXES}\n${query}`;
  const response = await mas.querySudo(query);
  const sparqlJsonParser = new sjp.SparqlJsonParser();
  const parsedResults = sparqlJsonParser.parseJsonResults(response);
  console.log(`Parsed ${parsedResults.length} triples`);
  parsedResults.forEach((binding) =>
    store.addQuad(quad(binding.s, binding.p, binding.o))
  );
}

async function constructConceptSchemes(store) {
  for (let conceptScheme of env.TOEZICHT_CONCEPT_SCHEMES) {
    console.log(`Adding concept scheme ${conceptScheme} to meta graph`);
    await addTriples(
      store,
      `SELECT ?s ?p ?o WHERE {
        GRAPH ${mu.sparqlEscapeUri(env.PUBLIC_GRAPH)} {
          ?s skos:inScheme ${mu.sparqlEscapeUri(conceptScheme)} .
          ?s ?p ?o .
        }
      }`
    );
  }
}

async function addRelevantDossierTypes(submissionDocument, store) {
  console.log('Adding relevant dossier types to meta graph');
  const bestuurseenheid = await getBestuurseenheidFor(submissionDocument);
  await addTriples(
    store,
    `SELECT ?s ?p ?o WHERE {
      GRAPH ${mu.sparqlEscapeUri(env.PUBLIC_GRAPH)} {
        ${mu.sparqlEscapeUri(bestuurseenheid.value)}
          besluit:classificatie ?classificatie .
        ?s
          lblodBesluit:decidableBy ?classificatie ;
          skos:inScheme ${mu.sparqlEscapeUri(env.TYPE_DOSSIER_CONCEPT_SCHEME)} .
        ?s ?p ?o .
      }
    }`
  );
}

async function addUserFriendlyChartOfAccounts(store) {
  await addTriples(
    store,
    `CONSTRUCT {
      ?entry
        rdf:type skos:Concept ;
        skos:inScheme ?scheme ;
        skos:prefLabel ?newLabel .
    }
    WHERE {
      GRAPH ${mu.sparqlEscapeUri(env.PUBLIC_GRAPH)} {
        ?entry
          rdf:type skos:Concept;
          skos:inScheme ?scheme ;
          skos:notation ?notation ;
          skos:prefLabel ?label ;
          skos:topConceptOf
            <http://lblod.data.gift/concept-schemes/b65b15ba-6755-4cd2-bd07-2c2cf3c0e4d3> .
        BIND(CONCAT(?notation, ' - ', ?label) as ?newLabel)
      }
    }`
  );
}

/**
 * Enrich the harvested data with the known bestuursorganen of the bestuurseenheid
 * that submitted the document
 */
async function addBestuursorganenForBestuurseenheid(submissionDocument, store) {
  console.log(
    `Adding bestuursorganen for submission document ${submissionDocument.value} to meta graph`
  );

  await addTriples(
    store,
    `CONSTRUCT {
      ${mu.sparqlEscapeUri(env.BESTUURSORGAAN_SELECT_CONCEPT_SCHEME)}
        rdf:type skos:ConceptScheme .
      ?bestuursorgaan
        besluit:bestuurt ?bestuurseenheid ;
        skos:prefLabel ?bestuursorgaanLabel ;
        besluit:classificatie ?bestuursorgaanClassificatie .
      ?bestuursorgaanClassificatie
        skos:prefLabel ?bestuursorgaanClassificatieLabel .
      ?bestuursorgaanInTijd
        mandaat:isTijdspecialisatieVan ?bestuursorgaan ;
        mandaat:bindingStart ?start .
      ?bestuurseenheid
        besluit:classificatie ?bestuurseenheidClassificatie .
      ?bestuurseenheidClassificatie
        skos:prefLabel ?bestuurseenheidClassificatieLabel .
      ?bestuursorgaanInTijd
        mandaat:bindingEinde ?end ;
        skos:prefLabel ?botLabel ;
        skos:inScheme
          ${mu.sparqlEscapeUri(env.BESTUURSORGAAN_SELECT_CONCEPT_SCHEME)} .
    }
    WHERE {
      GRAPH ?g {
        ?submission
          dct:subject ${mu.sparqlEscapeUri(submissionDocument.value)} ;
          pav:createdBy ?bestuurseenheid .
      }
      GRAPH <${env.PUBLIC_GRAPH}> {
        ?bestuursorgaan
          besluit:bestuurt ?bestuurseenheid ;
          skos:prefLabel ?bestuursorgaanLabel ;
          besluit:classificatie ?bestuursorgaanClassificatie .
        ?bestuursorgaanClassificatie
          skos:prefLabel ?bestuursorgaanClassificatieLabel.
        ?bestuursorgaanInTijd
          mandaat:isTijdspecialisatieVan ?bestuursorgaan ;
          mandaat:bindingStart ?start .
        ?bestuurseenheid
          besluit:classificatie ?bestuurseenheidClassificatie .
        ?bestuurseenheidClassificatie
          skos:prefLabel ?bestuurseenheidClassificatieLabel .

        OPTIONAL { ?bestuursorgaanInTijd mandaat:bindingEinde ?end . }

        FILTER NOT EXISTS {
          ?bestuursorgaanInTijd lblodlg:heeftBestuursfunctie ?leidinggevende .
        }

        BIND(
          IF(bound(?end),
            CONCAT(?bestuursorgaanClassificatieLabel, ' ', year(?start), ' - ', year(?end)),
            CONCAT(?bestuursorgaanClassificatieLabel, ' sinds ', year(?start)))
          as ?botLabel)
      }
    }`
  );
}

async function getBestuurseenheidFor(submissionDocument) {
  const response = await mas.querySudo(`
    ${cts.SPARQL_PREFIXES}
    SELECT ?bestuurseenheid WHERE {
      GRAPH ?g {
        ?submission
          dct:subject ${mu.sparqlEscapeUri(submissionDocument.value)} ;
          pav:createdBy ?bestuurseenheid .
      }
    }
  `);
  const sparqlJsonParser = new sjp.SparqlJsonParser();
  const parsedResults = sparqlJsonParser.parseJsonResults(response);
  return parsedResults[0]?.bestuurseenheid;
}
