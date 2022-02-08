import {sparqlEscapeUri} from 'mu';
import {querySudo as query} from '@lblod/mu-auth-sudo';
import {sym, lit} from 'rdflib';
import {
  BESLUIT,
  defaultGraph, MANDAAT,
  PUBLIC_GRAPH,
  RDF,
  SKOS, XSD,
} from '../rdflib-helpers';
import {parseResult} from '../sparql-helpers';

const CONCEPT_SCHEME = 'http://data.lblod.info/concept-schemes/481c03f0-d07f-424e-9c2b-8d4cfb141c72';

/**
 * Extract the known bestuursorganen of the bestuurseenheid
 * that created the submission
 */
export default async function(store, {subject}) {

  const rows = parseResult(await query(`PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX pav: <http://purl.org/pav/>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX mandaat: <http://data.vlaanderen.be/ns/mandaat#>
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
PREFIX lblodlg: <http://data.lblod.info/vocabularies/leidinggevenden/>
SELECT *
WHERE {
  GRAPH ?g {
    ?submission dct:subject ${sparqlEscapeUri(subject)} ;
                pav:createdBy ?bestuurseenheid .
  }
  GRAPH ${sparqlEscapeUri(PUBLIC_GRAPH)} {
    ?bestuursorgaan besluit:bestuurt ?bestuurseenheid ;
                    besluit:classificatie ?bestuursorgaanClassificatie .
    ?bestuursorgaanClassificatie skos:prefLabel ?bestuursorgaanClassificatieLabel .
    ?bestuursorgaanInTijd mandaat:isTijdspecialisatieVan ?bestuursorgaan .
    ?bestuurseenheid besluit:classificatie ?bestuurseenheidClassificatie .
    ?bestuurseenheidClassificatie skos:prefLabel ?bestuurseenheidClassificatieLabel .
    OPTIONAL {
      ?bestuursorgaanInTijd mandaat:bindingStart ?start .
    }
    OPTIONAL {
      ?bestuursorgaanInTijd mandaat:bindingEinde ?end .
    }
    OPTIONAL {
      ?bestuursorgaan skos:prefLabel ?bestuursorgaanLabel .
    }
    FILTER NOT EXISTS {
      ?bestuursorgaanInTijd lblodlg:heeftBestuursfunctie ?leidinggevende .
    }
  }
}
ORDER BY DESC(?start) DESC(?end)`));

  rows.forEach((row, index) => {
    /**
     * If the start-date was not supplied,
     * we assume the previous end-date as our start-date.
     */
    let start = row.start;
    if (index !== 0 && !start)
      start = rows[index - 1].end;

    const {
      bestuursorgaan,
      bestuurseenheid,
      bestuursorgaanClassificatie,
      bestuursorgaanClassificatieLabel,
      bestuursorgaanInTijd,
      bestuurseenheidClassificatie,
      bestuurseenheidClassificatieLabel,
      end,
      bestuursorgaanLabel,
    } = row;

    store.add(
        sym(CONCEPT_SCHEME),
        RDF('type'),
        SKOS('ConceptScheme'),
        sym(defaultGraph));
    store.add(
        sym(bestuursorgaan),
        BESLUIT('bestuurt'),
        sym(bestuurseenheid),
        sym(defaultGraph));
    store.add(
        sym(bestuursorgaan),
        BESLUIT('classificatie'),
        sym(bestuursorgaanClassificatie),
        sym(defaultGraph));
    store.add(
        sym(bestuursorgaanClassificatie),
        SKOS('prefLabel'),
        bestuursorgaanClassificatieLabel,
        sym(defaultGraph));
    store.add(
        sym(bestuursorgaanInTijd),
        MANDAAT('isTijdspecialisatieVan'),
        sym(bestuursorgaan),
        sym(defaultGraph));
    store.add(
        sym(bestuursorgaanInTijd),
        MANDAAT('bindingStart'),
        lit(start, '', XSD('dateTime')),
        sym(defaultGraph));
    store.add(
        sym(bestuurseenheid),
        BESLUIT('classificatie'),
        sym(bestuurseenheidClassificatie),
        sym(defaultGraph));
    store.add(
        sym(bestuurseenheidClassificatie),
        SKOS('prefLabel'),
        bestuurseenheidClassificatieLabel,
        sym(defaultGraph));
    store.add(
        sym(bestuursorgaanInTijd),
        SKOS('inScheme'),
        sym(CONCEPT_SCHEME),
        sym(defaultGraph));

    // Optional Values
    if (end)
      store.add(sym(bestuursorgaanInTijd),
          MANDAAT('bindingEinde'),
          lit(end, '', XSD('dateTime')),
          sym(defaultGraph));
    if (bestuursorgaanLabel)
      store.add(
          sym(bestuursorgaan),
          SKOS('prefLabel'),
          bestuursorgaanLabel,
          sym(defaultGraph));

    // Generated values
    let buffer = [bestuursorgaanClassificatieLabel];
    if (start) {
      buffer.push(`${end ? '' : 'sinds'}`);
      buffer.push(start.getFullYear());
      buffer.push(`${end ? `- ${end.getFullYear()}` : ''}`);
    }
    store.add(
        sym(bestuursorgaanInTijd),
        SKOS('prefLabel'),
        buffer.join(' '),
        sym(defaultGraph));
  });
}