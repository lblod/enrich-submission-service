import {sparqlEscapeUri} from 'mu';
import {graph as rdflibStore, sym, lit} from 'rdflib';
import {querySudo as query} from "@lblod/mu-auth-sudo";
import {PUBLIC_GRAPH, BESLUIT, defaultGraph, MANDAAT, addTriples, RDF, SKOS, XSD, serialize} from "./rdflib-helpers";

const BESTUURSORGAAN_SELECT_CONCEPT_SCHEME = 'http://data.lblod.info/concept-schemes/481c03f0-d07f-424e-9c2b-8d4cfb141c72';
const TYPE_DOSSIER_CONCEPT_SCHEME = 'http://lblod.data.gift/concept-schemes/71e6455e-1204-46a6-abf4-87319f58eaa5';
const TOEZICHT_CONCEPT_SCHEMES = [
  'http://lblod.data.gift/concept-schemes/c93ccd41-aee7-488f-86d3-038de890d05a', // reglementtype
  'http://lblod.data.gift/concept-schemes/5cecec47-ba66-4d7a-ac9d-a1e7962ca4e2', // document authenticity type
  'http://lblod.data.gift/concept-schemes/3037c4f4-1c63-43ac-bfc4-b41d098b15a6', // tax type
  'http://lblod.data.gift/concept-schemes/a995bb71-3c87-4385-a06b-a786f2fa0d16', // Decision adoption type
  'http://lblod.data.gift/concept-schemes/60d620a5-ec34-4a91-ba84-fff0813d0ccc', // Municipal road procedure
  'http://data.vlaanderen.be/id/conceptscheme/BestuursorgaanClassificatieCode',
  'http://data.vlaanderen.be/id/conceptscheme/BestuurseenheidClassificatieCode'
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
  await addBestuursorganenForBestuurseenheid(submissionDocument, store);

  return serialize(store);
}

async function constructConceptSchemes(store) {
  for (let conceptScheme of TOEZICHT_CONCEPT_SCHEMES) {
    console.log(`Adding concept scheme ${conceptScheme} to meta graph`);
    await addTriples(store, {
      WHERE: `?s skos:inScheme ${sparqlEscapeUri(conceptScheme)} .`
    });
  }
}

async function addRelevantDossierTypes(submissionDocument, store) {
  console.log(`Adding relevant dossier types to meta graph`);
  const bestuurseenheid = await getBestuurseenheidFor(submissionDocument);
  await addTriples(store, {
    WHERE: `${sparqlEscapeUri(bestuurseenheid)} besluit:classificatie ?classificatie .
            ?s <http://lblod.data.gift/vocabularies/besluit/decidableBy> ?classificatie ;
                skos:inScheme ${sparqlEscapeUri(TYPE_DOSSIER_CONCEPT_SCHEME)} .`
  })
}

async function addUserFriendlyChartOfAccounts(store){
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
  for(const binding of results.results.bindings){
    const subject = binding['entry'].value;
    const scheme = binding['scheme'].value;
    const notation = binding['notation'].value;
    const label = binding['label'].value;
    const newLabel = `${notation} - ${label}`;

    store.add(sym(subject), RDF('type'), sym("http://www.w3.org/2004/02/skos/core#Concept"), sym(defaultGraph));
    store.add(sym(subject), SKOS('inScheme'), sym(scheme), sym(defaultGraph));
    store.add(sym(subject), SKOS('prefLabel'), newLabel, sym(defaultGraph));
  }

  return store;
}
/**
 * Enrich the harvested data with the known bestuursorganen of the bestuurseenheid
 * that submitted the document
 */
async function addBestuursorganenForBestuurseenheid(submissionDocument, store) {
  console.log(`Adding bestuursorganen for submission document ${submissionDocument} to meta graph`);

  const result = await query(`
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX pav: <http://purl.org/pav/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX mandaat: <http://data.vlaanderen.be/ns/mandaat#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX lblodlg: <http://data.lblod.info/vocabularies/leidinggevenden/>

    SELECT *
    WHERE {
        GRAPH ?g {
          ?submission dct:subject ${sparqlEscapeUri(submissionDocument)} ;
            pav:createdBy ?bestuurseenheid .
        }
        GRAPH <${PUBLIC_GRAPH}> {
          ?bestuursorgaan besluit:bestuurt ?bestuurseenheid ;
            skos:prefLabel ?bestuursorgaanLabel ;
            besluit:classificatie ?bestuursorgaanClassificatie .
          ?bestuursorgaanClassificatie skos:prefLabel ?bestuursorgaanClassificatieLabel.
          ?bestuursorgaanInTijd mandaat:isTijdspecialisatieVan ?bestuursorgaan ;
            mandaat:bindingStart ?start .
          ?bestuurseenheid besluit:classificatie ?bestuurseenheidClassificatie .
          ?bestuurseenheidClassificatie skos:prefLabel ?bestuurseenheidClassificatieLabel .

          OPTIONAL { ?bestuursorgaanInTijd mandaat:bindingEinde ?end . }

          FILTER NOT EXISTS {
            ?bestuursorgaanInTijd lblodlg:heeftBestuursfunctie ?leidinggevende .
          }
        }
    }
  `);

  if (result.results.bindings.length) {
    result.results.bindings.forEach(b => {

      const bestuursorgaan = b['bestuursorgaan'].value;
      const bestuurseenheid = b['bestuurseenheid'].value;
      const bestuursorgaanLabel = b['bestuursorgaanLabel'].value;
      const bestuursorgaanClassificatie = b['bestuursorgaanClassificatie'].value;
      const bestuursorgaanClassificatieLabel = b['bestuursorgaanClassificatieLabel'].value;
      const bestuurseenheidClassificatie = b['bestuurseenheidClassificatie'].value;
      const bestuurseenheidClassificatieLabel = b['bestuurseenheidClassificatieLabel'].value;
      const bestuursorgaanInTijd = b['bestuursorgaanInTijd'].value;
      const start = new Date(b['start'].value);
      const end = b['end'] ? new Date(b['end'].value) : '';

      const botLabel = `${bestuursorgaanClassificatieLabel} ${end ? "" : "sinds"} ${start.getFullYear()} ${end ? ` - ${end.getFullYear()}` : ""}`;

      store.add(sym(BESTUURSORGAAN_SELECT_CONCEPT_SCHEME), RDF('type'), SKOS('ConceptScheme'), sym(defaultGraph));
      store.add(sym(bestuursorgaan), BESLUIT('bestuurt'), sym(bestuurseenheid), sym(defaultGraph));
      store.add(sym(bestuursorgaan), SKOS('prefLabel'), bestuursorgaanLabel, sym(defaultGraph));
      store.add(sym(bestuursorgaan), BESLUIT('classificatie'), sym(bestuursorgaanClassificatie), sym(defaultGraph));
      store.add(sym(bestuursorgaanClassificatie), SKOS('prefLabel'), bestuursorgaanClassificatieLabel, sym(defaultGraph));
      store.add(sym(bestuursorgaanInTijd), MANDAAT('isTijdspecialisatieVan'), sym(bestuursorgaan), sym(defaultGraph));
      store.add(sym(bestuursorgaanInTijd), MANDAAT('bindingStart'), lit(start, '', XSD('dateTime')), sym(defaultGraph));
      store.add(sym(bestuurseenheid), BESLUIT('classificatie'), sym(bestuurseenheidClassificatie), sym(defaultGraph));
      store.add(sym(bestuurseenheidClassificatie), SKOS('prefLabel'), bestuurseenheidClassificatieLabel, sym(defaultGraph));

      if (end) {
        store.add(sym(bestuursorgaanInTijd), MANDAAT('bindingEinde'), lit(end, '', XSD('dateTime')), sym(defaultGraph));
      }
      store.add(sym(bestuursorgaanInTijd), SKOS('prefLabel'), botLabel, sym(defaultGraph));
      store.add(sym(bestuursorgaanInTijd), SKOS('inScheme'), sym(BESTUURSORGAAN_SELECT_CONCEPT_SCHEME), sym(defaultGraph));
    });
  }
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
