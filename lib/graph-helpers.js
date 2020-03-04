import fs from 'fs-extra';
import request from 'request';
import { sparqlEscapeUri, sparqlEscapeString, uuid } from 'mu';
import { querySudo as query } from '@lblod/mu-auth-sudo';

const batchSize = parseInt(process.env.CONSTRUCT_BATCH_SIZE) || 1000;

/**
 * Return all triples of a graph as a string in Turtle format.
 *
 * @param {string} graph URI of the graph to export
*/
async function writeToString(graph) {
  const tmpFile = `/tmp/${uuid()}.ttl`;
  await writeToFile(graph, tmpFile);
  const result = await fs.readFile(tmpFile, 'utf-8');
  await fs.unlink(tmpFile);
  return result;
}

/**
 * Write all triples of a graph to a file in Turtle format.
 *
 * @param {string} graph URI of the graph to export
 * @param {string} file Absolute path of the file to export to (e.g. /data/exports/my-graph.ttl)
*/
async function writeToFile(graph, file) {
  const tmpFile = `${file}.tmp`;

  const count = await countTriples(graph);
  console.log(`Exporting 0/${count} triples from graph <${graph}>`);

  if (count > 0) {
    let offset = 0;
    const query = `
      SELECT ?s ?p ?o
      WHERE {
        GRAPH ${sparqlEscapeUri(graph)} {
          ?s ?p ?o .
        }
      }
      LIMIT ${batchSize} OFFSET %OFFSET
    `;

    while (offset < count) {
      await appendBatch(tmpFile, query, offset);
      offset = offset + batchSize;
      console.log(`Constructed ${offset < count ? offset : count}/${count} triples from graph <${graph}>`);
    }

    await fs.rename(tmpFile, file);
  }
}

async function countTriples(graph) {
  const queryResult = await query(`
      SELECT (COUNT(*) as ?count)
      WHERE {
        GRAPH ${sparqlEscapeUri(graph)} {
          ?s ?p ?o .
        }
      }
    `);

  return parseInt(queryResult.results.bindings[0].count.value);
}

async function appendBatch(file, q, offset = 0, limit = 1000) {
  const pagedQuery = q.replace('%OFFSET', offset);
  const result = await query(pagedQuery);

  if (result.results.bindings.length) {
    const ttl = result.results.bindings.map(b => selectResultToNT(b['s'], b['p'], b['o'])).join('\n');
    await fs.appendFile(file, ttl + '\n');
  }
}

function selectResultToNT(s, p, o) {
  const subject = sparqlEscapeUri(s.value);
  const predicate = sparqlEscapeUri(p.value);
  let obj;
  if (o.type == 'uri') {
    obj = sparqlEscapeUri(o.value);
  } else {
    obj = `"${clearNewlines(o.value)}"`;
    if (o.datatype)
      obj += `^^${sparqlEscapeUri(o.datatype)}`;
  }
  return `${subject} ${predicate} ${obj} .`;
}

// TODO don't understand why we have to do this. The string comes from a Virtuoso JSON result; why do we still have to escape?
function clearNewlines( string ) {
  return string.replace(/\n/g, function(match) { return ''; }).replace(/\r/g, function(match) { return '';});
}

export {
  writeToFile,
  writeToString
}
