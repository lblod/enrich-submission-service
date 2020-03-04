import { sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime, sparqlEscapeInt, uuid } from 'mu';
import { updateSudo as update } from '@lblod/mu-auth-sudo';
import fs from 'fs-extra';

const FILE_GRAPH = process.env.FILE_GRAPH || 'http://mu.semte.ch/graphs/public';

/**
 * Returns the content of the given file
 *
 * @param string file URI of the file to get the content for
*/
async function getFileContent(file) {
  console.log(`Getting contents of file ${file}`);
  const path = file.replace('share://', '/share/');
  const content = await fs.readFile(path, 'utf8');
  return content;
};

/**
 * Write the given TTL content to a file and relates it to the given submitted document
 *
 * @param string ttl Turtle to write to the file
*/
async function insertTtlFile(content) {
  const id = uuid();
  const filename = `${id}.ttl`;
  const path = `/share/submissions/${filename}`;
  const uri = path.replace('/share/', 'share://');
  const now = new Date();

  try {
    await fs.writeFile(path, content, 'utf-8');
  } catch (e) {
    console.log(`Failed to write TTL to file <${uri}>.`);
    throw e;
  }

  try {
    const stats = await fs.stat(path);
    const fileSize = stats.size;

    await update(`
      PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
      PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX dbpedia: <http://dbpedia.org/ontology/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      INSERT DATA {
        GRAPH ${sparqlEscapeUri(FILE_GRAPH)} {
          ${sparqlEscapeUri(uri)} a nfo:FileDataObject ;
                                  mu:uuid ${sparqlEscapeString(id)};
                                  nfo:fileName ${sparqlEscapeString(filename)} ;
                                  dct:creator <http://lblod.data.gift/services/enrich-submission-service>;
                                  dct:created ${sparqlEscapeDateTime(now)};
                                  dct:modified ${sparqlEscapeDateTime(now)};
                                  dct:format "text/turtle";
                                  nfo:fileSize ${sparqlEscapeInt(fileSize)};
                                  dbpedia:fileExtension "ttl" .
        }
      }
`);

  } catch (e) {
    console.log(`Failed to write TTL resource <${uri}> to triplestore.`);
    throw e;
  }

  return uri;
}

async function updateTtlFile(uri, content) {
  const path = uri.replace('share://', '/share/');
  const now = new Date();

  try {
    await fs.writeFile(path, content, 'utf-8');
  } catch (e) {
    console.log(`Failed to write TTL to file <${uri}>.`);
    throw e;
  }

  try {
    const stats = await fs.stat(path);
    const fileSize = stats.size;

    await update(`
      PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
      PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX dbpedia: <http://dbpedia.org/ontology/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      DELETE WHERE {
        GRAPH ${sparqlEscapeUri(FILE_GRAPH)} {
          ${sparqlEscapeUri(uri)} dct:modified ?modified ;
                                  nfo:fileSize ?fileSize .
        }
      }

      ;

      INSERT DATA {
        GRAPH ${sparqlEscapeUri(FILE_GRAPH)} {
          ${sparqlEscapeUri(uri)} dct:modified ${sparqlEscapeDateTime(now)} ;
                                  nfo:fileSize ${sparqlEscapeInt(fileSize)} .
        }
      }
`);

  } catch (e) {
    console.log(`Failed to update TTL resource <${uri}> in triplestore.`);
    throw e;
  }
}

export {
  FILE_GRAPH,
  getFileContent,
  insertTtlFile,
  updateTtlFile
}
