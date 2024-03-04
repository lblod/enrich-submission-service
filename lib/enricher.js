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
  'http://data.vlaanderen.be/id/conceptscheme/BestuurseenheidClassificatieCode',
  'http://lblod.data.gift/concept-schemes/4e719768-d43b-4ca1-ab92-b463e15721f5', //Reporting period long term plan worship services
  'http://lblod.data.gift/concept-schemes/91655ebf-5ab7-43c4-b587-094536baf737', // Authenticity type (specific for erediensten)
  'http://lblod.data.gift/concept-schemes/c2e7699a-b543-443c-b8b2-b60bef8767dc', // Authentieke bron LEKP-report
  'http://lblod.data.gift/concept-schemes/5d05a003-4692-4aff-9e93-325db2aefb8a', // LEKP-Goal
  'http://lblod.data.gift/concept-schemes/0b93ef1c-4435-4922-8611-31b4f3ca3c85', // Explanation type LEKP
  'http://lblod.data.gift/concept-schemes/1dfc51af-99fd-4be9-a681-41360c195f14', // Correction type LEKP
  'http://lblod.data.gift/concept-schemes/7856206c-dfda-4163-8bd3-f465c794eced', // Inhoud besluit (over budget wijziging - Akteneming, Aanpassingsbesluit and Goedkeuringsbesluit)
  'http://lblod.data.gift/concept-schemes/56ef78a0-5ab4-4548-b995-fd995703183c', // LEKP Collectieve energierenovatie
  'http://lblod.data.gift/concept-schemes/ba36f197-1a96-4ea2-a7f7-3b5c7ffcd6ee', // Type beroepsprocedure
  'http://lblod.data.gift/concept-schemes/27f40c36-141d-42e9-bed8-fea1a47c4869'  // Type afschrift
];

const EREDIENSTEN_AND_CENTRALE_BESTUREN_FILTERED_GO_PO_SCHEME =
  "http://lblod.data.gift/concept-schemes/362a6a78-6431-4d0a-b20d-22f1faca4130";
const EREDIENSTEN_FILTERED_GO_PO_SCHEME =
  "http://lblod.data.gift/concept-schemes/2e136902-f709-4bf7-a54a-9fc820cf9f07";
const EREDIENSTEN_RO_SCHEME =
  "http://lblod.data.gift/concept-schemes/164a27d5-cf7e-43ea-996b-21645c02a920";
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
  await addFilteredEredienstenGOAndPO(submissionDocument, store);
  await addFilteredEredienstenRO(submissionDocument, store);
  await addFilteredEredienstenAndCentraleBesturenGOAndPO(submissionDocument, store);

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

/**
 * Filters the input form field values to display only the ones with following URI <http://lblod.data.gift/concepts/ac400cc9f135ac7873fb3e551ec738c1>
 * that represents the local involvement "Toezichthoudend"
 */
async function addFilteredEredienstenAndCentraleBesturenGOAndPO(submissionDocument, store) {
  console.log(`Adding linked worship-services to meta graph`);
  const bestuurseenheid = await getBestuurseenheidFor(submissionDocument);
  const q = `
  SELECT DISTINCT ?erediensten ?label ?classificatie WHERE {
    GRAPH ?g {
        VALUES ?classificatie {
            <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/f9cac08a-13c1-49da-9bcb-f650b0604054>
            <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/66ec74fd-8cfc-4e16-99c6-350b35012e86>
        }
        BIND(<http://lblod.data.gift/concepts/ac400cc9f135ac7873fb3e551ec738c1> AS ?typeBetrokkenheid) 
        ${sparqlEscapeUri(bestuurseenheid)} <http://data.lblod.info/vocabularies/erediensten/betrokkenBestuur> ?betrokkenBestuur.
        ?betrokkenBestuur <http://data.lblod.info/vocabularies/erediensten/typebetrokkenheid> ?typeBetrokkenheid;
            <http://www.w3.org/ns/org#organization> ?erediensten.
        ?erediensten <http://data.vlaanderen.be/ns/besluit#classificatie> ?classificatie;
            <http://www.w3.org/2004/02/skos/core#prefLabel> ?label.
    }
  }
  `;

  const results = await query(q);
  for (const binding of results.results.bindings) {
    const subject = binding["erediensten"].value;
    const type = binding["classificatie"].value;
    const label = binding["label"].value;

    store.add(
      sym(subject),
      RDF("type"),
      sym("http://www.w3.org/2004/02/skos/core#Concept"),
      sym(defaultGraph)
    );
    store.add(sym(subject), RDF("type"), sym(type), sym(defaultGraph));
    store.add(
      sym(subject),
      SKOS("inScheme"),
      sym(EREDIENSTEN_AND_CENTRALE_BESTUREN_FILTERED_GO_PO_SCHEME),
      sym(defaultGraph)
    );
    store.add(sym(subject), SKOS("prefLabel"), label , sym(defaultGraph));
  }

  return store;

}

/**
 * Filters the input form field values to display only the ones with following URI <http://lblod.data.gift/concepts/ac400cc9f135ac7873fb3e551ec738c1>
 * that represents the local involvement "Toezichthoudend"
 */
async function addFilteredEredienstenGOAndPO(submissionDocument, store) {
  console.log(`Adding linked worship-services to meta graph`);
  const bestuurseenheid = await getBestuurseenheidFor(submissionDocument);
  const q = `
  SELECT DISTINCT ?erediensten ?label ?classificatie WHERE {
    GRAPH ?g {
      VALUES ?classificatie {
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/66ec74fd-8cfc-4e16-99c6-350b35012e86>
      }
      BIND(<http://lblod.data.gift/concepts/ac400cc9f135ac7873fb3e551ec738c1> AS ?typeBetrokkenheid)
      ${sparqlEscapeUri(bestuurseenheid)} <http://data.lblod.info/vocabularies/erediensten/betrokkenBestuur> ?betrokkenBestuur.
      ?betrokkenBestuur <http://data.lblod.info/vocabularies/erediensten/typebetrokkenheid> ?typeBetrokkenheid;
          <http://www.w3.org/ns/org#organization> ?erediensten.
      ?erediensten <http://data.vlaanderen.be/ns/besluit#classificatie> ?classificatie;
          <http://www.w3.org/2004/02/skos/core#prefLabel> ?label.
    }
  }
  `;

  const results = await query(q);
  for (const binding of results.results.bindings) {
    const subject = binding["erediensten"].value;
    const type = binding["classificatie"].value;
    const label = binding["label"].value;

    store.add(
      sym(subject),
      RDF("type"),
      sym("http://www.w3.org/2004/02/skos/core#Concept"),
      sym(defaultGraph)
    );
    store.add(sym(subject), RDF("type"), sym(type), sym(defaultGraph));
    store.add(
      sym(subject),
      SKOS("inScheme"),
      sym(EREDIENSTEN_FILTERED_GO_PO_SCHEME),
      sym(defaultGraph)
    );
    store.add(sym(subject), SKOS("prefLabel"), label , sym(defaultGraph));
  }

  return store;
}

async function addFilteredEredienstenRO(submissionDocument, store) {
  console.log(`Adding linked worship-services RO to meta graph`);
  const bestuurseenheid = await getBestuurseenheidFor(submissionDocument);
  const q = `
  SELECT DISTINCT ?erediensten ?label ?classificatie WHERE {
    GRAPH ?g {
      VALUES ?classificatie {
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/66ec74fd-8cfc-4e16-99c6-350b35012e86>
      }
      ${sparqlEscapeUri(bestuurseenheid)} <http://www.w3.org/ns/org#linkedTo> ?erediensten.
      ?erediensten <http://data.vlaanderen.be/ns/besluit#classificatie> ?classificatie;
          <http://www.w3.org/2004/02/skos/core#prefLabel> ?label.
    }
  }
  `;

  const results = await query(q);
  for (const binding of results.results.bindings) {
    const subject = binding["erediensten"].value;
    const type = binding["classificatie"].value;
    const label = binding["label"].value;

    store.add(
      sym(subject),
      RDF("type"),
      sym("http://www.w3.org/2004/02/skos/core#Concept"),
      sym(defaultGraph)
    );
    store.add(sym(subject), RDF("type"), sym(type), sym(defaultGraph));
    store.add(
      sym(subject),
      SKOS("inScheme"),
      sym(EREDIENSTEN_RO_SCHEME),
      sym(defaultGraph)
    );
    store.add(sym(subject), SKOS("prefLabel"), label , sym(defaultGraph));
  }

  return store;
 }
