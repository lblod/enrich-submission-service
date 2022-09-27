import { sparqlEscapeUri } from 'mu';
import { graph as rdflibStore, sym, lit } from 'rdflib';
import { querySudo as query } from '@lblod/mu-auth-sudo';
import {
  BESLUIT,
  MANDAAT,
  addTriples,
  RDF,
  SKOS,
  XSD,
  serialize,
} from './rdflib-helpers';
import * as env from '../env.js';

/**
 * Enrich the harvested triples dataset with derived knowledge
 * based on the current harvested triples and the data in the triplestore.
 */
export default async function enrich(submissionDocument) {
  const store = rdflibStore();

  await constructConceptSchemes(store);
  await addRelevantDossierTypes(submissionDocument, store);
  await addUserFriendlyChartOfAccounts(store);
  await addBestuursorganenForBestuurseenheid(submissionDocument, store);

  return serialize(store);
}

async function constructConceptSchemes(store) {
  for (let conceptScheme of env.TOEZICHT_CONCEPT_SCHEMES) {
    console.log(`Adding concept scheme ${conceptScheme} to meta graph`);
    await addTriples(store, {
      WHERE: `?s skos:inScheme ${sparqlEscapeUri(conceptScheme)} .`,
    });
  }
}

async function addRelevantDossierTypes(submissionDocument, store) {
  console.log('Adding relevant dossier types to meta graph');
  const bestuurseenheid = await getBestuurseenheidFor(submissionDocument);
  await addTriples(store, {
    WHERE: `
      ${sparqlEscapeUri(bestuurseenheid)}
        besluit:classificatie ?classificatie .
      ?s
        <http://lblod.data.gift/vocabularies/besluit/decidableBy>
          ?classificatie ;
        skos:inScheme ${sparqlEscapeUri(env.TYPE_DOSSIER_CONCEPT_SCHEME)} .`,
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
               <http://www.w3.org/2004/02/skos/core#topConceptOf>
                 <http://lblod.data.gift/concept-schemes/b65b15ba-6755-4cd2-bd07-2c2cf3c0e4d3> .
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

    store.add(
      sym(subject),
      RDF('type'),
      sym('http://www.w3.org/2004/02/skos/core#Concept'),
      sym(env.DEFAULTGRAPH)
    );
    store.add(sym(subject), SKOS('inScheme'), sym(scheme), sym(env.DEFAULTGRAPH));
    store.add(sym(subject), SKOS('prefLabel'), newLabel, sym(env.DEFAULTGRAPH));
  }

  return store;
}
/**
 * Enrich the harvested data with the known bestuursorganen of the bestuurseenheid
 * that submitted the document
 */
async function addBestuursorganenForBestuurseenheid(submissionDocument, store) {
  console.log(
    `Adding bestuursorganen for submission document ${submissionDocument} to meta graph`
  );

  const result = await query(`
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX pav: <http://purl.org/pav/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX mandaat: <http://data.vlaanderen.be/ns/mandaat#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX lblodlg: <http://data.lblod.info/vocabularies/leidinggevenden/>

    SELECT * WHERE {
      GRAPH ?g {
        ?submission
          dct:subject ${sparqlEscapeUri(submissionDocument)} ;
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
      }
    }
  `);

  if (result.results.bindings.length) {
    result.results.bindings.forEach((b) => {
      const bestuursorgaan = b['bestuursorgaan'].value;
      const bestuurseenheid = b['bestuurseenheid'].value;
      const bestuursorgaanLabel = b['bestuursorgaanLabel'].value;
      const bestuursorgaanClassificatie =
        b['bestuursorgaanClassificatie'].value;
      const bestuursorgaanClassificatieLabel =
        b['bestuursorgaanClassificatieLabel'].value;
      const bestuurseenheidClassificatie =
        b['bestuurseenheidClassificatie'].value;
      const bestuurseenheidClassificatieLabel =
        b['bestuurseenheidClassificatieLabel'].value;
      const bestuursorgaanInTijd = b['bestuursorgaanInTijd'].value;
      const start = new Date(b['start'].value);
      const end = b['end'] ? new Date(b['end'].value) : '';

      const botLabel = `${bestuursorgaanClassificatieLabel} ${
        end ? '' : 'sinds'
      } ${start.getFullYear()} ${end ? ` - ${end.getFullYear()}` : ''}`;

      store.add(
        sym(env.BESTUURSORGAAN_SELECT_CONCEPT_SCHEME),
        RDF('type'),
        SKOS('ConceptScheme'),
        sym(env.DEFAULTGRAPH)
      );
      store.add(
        sym(bestuursorgaan),
        BESLUIT('bestuurt'),
        sym(bestuurseenheid),
        sym(env.DEFAULTGRAPH)
      );
      store.add(
        sym(bestuursorgaan),
        SKOS('prefLabel'),
        bestuursorgaanLabel,
        sym(env.DEFAULTGRAPH)
      );
      store.add(
        sym(bestuursorgaan),
        BESLUIT('classificatie'),
        sym(bestuursorgaanClassificatie),
        sym(env.DEFAULTGRAPH)
      );
      store.add(
        sym(bestuursorgaanClassificatie),
        SKOS('prefLabel'),
        bestuursorgaanClassificatieLabel,
        sym(env.DEFAULTGRAPH)
      );
      store.add(
        sym(bestuursorgaanInTijd),
        MANDAAT('isTijdspecialisatieVan'),
        sym(bestuursorgaan),
        sym(env.DEFAULTGRAPH)
      );
      store.add(
        sym(bestuursorgaanInTijd),
        MANDAAT('bindingStart'),
        lit(start, '', XSD('dateTime')),
        sym(env.DEFAULTGRAPH)
      );
      store.add(
        sym(bestuurseenheid),
        BESLUIT('classificatie'),
        sym(bestuurseenheidClassificatie),
        sym(env.DEFAULTGRAPH)
      );
      store.add(
        sym(bestuurseenheidClassificatie),
        SKOS('prefLabel'),
        bestuurseenheidClassificatieLabel,
        sym(env.DEFAULTGRAPH)
      );

      if (end) {
        store.add(
          sym(bestuursorgaanInTijd),
          MANDAAT('bindingEinde'),
          lit(end, '', XSD('dateTime')),
          sym(env.DEFAULTGRAPH)
        );
      }
      store.add(
        sym(bestuursorgaanInTijd),
        SKOS('prefLabel'),
        botLabel,
        sym(env.DEFAULTGRAPH)
      );
      store.add(
        sym(bestuursorgaanInTijd),
        SKOS('inScheme'),
        sym(env.BESTUURSORGAAN_SELECT_CONCEPT_SCHEME),
        sym(env.DEFAULTGRAPH)
      );
    });
  }
}

async function getBestuurseenheidFor(submissionDocument) {
  const result = await query(`
    PREFIX pav: <http://purl.org/pav/>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT * WHERE {
      GRAPH ?g {
        ?submission
          dct:subject ${sparqlEscapeUri(submissionDocument)} ;
          pav:createdBy ?bestuurseenheid .
      }
    }
  `);

  if (result.results.bindings.length) {
    return result.results.bindings[0]['bestuurseenheid'].value;
  }
}
