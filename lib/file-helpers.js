import { sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime, sparqlEscapeInt, uuid, update } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import fs from 'fs-extra';
import * as env from '../env.js';

const PUBLIC_FILES_GRAPH = process.env.PUBLIC_FILES_GRAPH || 'http://mu.semte.ch/graphs/public';

/**
 * Returns the content of the given file
 *
 * @param string file URI of the file to get the content for
*/
async function getFileContent(logicalFileUri) {
  const response = await querySudo(`
    ${env.PREFIXES}
    SELECT ?physicalFile WHERE {
      ?physicalFile nie:dataSource ${sparqlEscapeUri(logicalFileUri)} .
    }
  `);
  const physicalFileUri = response.results.bindings[0]?.physicalFile?.value;

  console.log(`Getting contents of file ${physicalFileUri}`);
  const path = physicalFileUri.replace('share://', '/share/');
  const content = await fs.readFile(path, 'utf8');
  return content;
};

async function getFileContentPhysical(physicalFileUri) {
  console.log(`Getting contents of file ${physicalFileUri}`);
  const path = physicalFileUri.replace('share://', '/share/');
  const content = await fs.readFile(path, 'utf8');
  return content;
}

/**
 * Write the given TTL content to a file and relates it to the given submitted document
 *
 * @param string ttl Turtle to write to the file
*/
async function insertTtlFile(submissionDocument, content) {
  const logicalId = uuid();
  const physicalId = uuid();
  const filename = `${physicalId}.ttl`;
  const path = `/share/submissions/${filename}`;
  const physicalUri = path.replace('/share/', 'share://');
  const logicalUri = env.PREFIX_TABLE.asj.concat(logicalId);
  const nowSparql = sparqlEscapeDateTime(new Date());

  try {
    await fs.writeFile(path, content, 'utf-8');
  } catch (e) {
    console.log(`Failed to write TTL to file <${path}>.`);
    throw e;
  }

  try {
    const stats = await fs.stat(path);
    const fileSize = stats.size;

    //Sudo required because may be called both from automatic-submission or user
    await updateSudo(`
      ${env.PREFIXES}
      INSERT {
        GRAPH ?g {
          ${sparqlEscapeUri(physicalUri)}
            a nfo:FileDataObject ;
            mu:uuid ${sparqlEscapeString(physicalId)} ;
            nie:dataSource asj:${logicalId} ;
            nfo:fileName ${sparqlEscapeString(filename)} ;
            dct:creator ${sparqlEscapeUri(env.CREATOR)} ;
            dct:created ${nowSparql} ;
            dct:modified ${nowSparql} ;
            dct:format "text/turtle" ;
            nfo:fileSize ${sparqlEscapeInt(fileSize)} ;
            dbpedia:fileExtension "ttl" .

          asj:${logicalId}
            a nfo:FileDataObject;
            mu:uuid ${sparqlEscapeString(logicalId)} ;
            nfo:fileName ${sparqlEscapeString(filename)} ;
            dct:creator ${sparqlEscapeUri(env.CREATOR)} ;
            dct:created ${nowSparql} ;
            dct:modified ${nowSparql} ;
            dct:format "text/turtle" ;
            nfo:fileSize ${sparqlEscapeInt(fileSize)} ;
            dbpedia:fileExtension "ttl" . 
        }
      }
      WHERE {
        GRAPH ?g {
          ${sparqlEscapeUri(submissionDocument)} a ext:SubmissionDocument .
        }
      }`);

  } catch (e) {
    console.log(`Failed to write TTL resource <${logicalUri}> to triplestore.`);
    throw e;
  }

  return logicalUri;
}

async function updateTtlFile(submissionDocument, logicalFileUri, content) {
  const response = await querySudo(`
    ${env.getPrefixes(['nie', 'ext'])}
    SELECT ?physicalUri WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)} a ext:SubmissionDocument .
        ?physicalUri nie:dataSource ${sparqlEscapeUri(logicalFileUri)} .
      }
    }
  `);
  const physicalUri = response.results.bindings[0].physicalUri.value;
  const path = physicalUri.replace('share://', '/share/');
  const now = new Date();

  try {
    await fs.writeFile(path, content, 'utf-8');
  } catch (e) {
    console.log(`Failed to write TTL to file <${path}>.`);
    throw e;
  }

  try {
    const stats = await fs.stat(path);
    const fileSize = stats.size;

    //Sudo required because may be called both from automatic-submission or user
    await updateSudo(`
      PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

      DELETE {
        GRAPH ?g {
          ${sparqlEscapeUri(physicalUri)}
            dct:modified ?modified ;
            nfo:fileSize ?fileSize .
          ${sparqlEscapeUri(logicalFileUri)}
            dct:modified ?modified ;
            nfo:fileSize ?fileSize .
        }
      }
      INSERT {
        GRAPH ?g {
          ${sparqlEscapeUri(physicalUri)}
            dct:modified ${sparqlEscapeDateTime(now)} ;
            nfo:fileSize ${sparqlEscapeInt(fileSize)} .
          ${sparqlEscapeUri(logicalFileUri)}
            dct:modified ${sparqlEscapeDateTime(now)} ;
            nfo:fileSize ${sparqlEscapeInt(fileSize)} .
        }
      }
      WHERE {
        GRAPH ?g {
          ${sparqlEscapeUri(submissionDocument)} a ext:SubmissionDocument .
        }
      }
  `);

  } catch (e) {
    console.log(`Failed to update TTL resource <${logicalFileUri}> in triplestore.`);
    throw e;
  }
}

/**
 * Deletes a ttl file in the triplestore and on disk
*/
async function deleteTtlFile(logicalFile) {
  const response = await query(`
    SELECT ?physicalUri WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(submissionDocument)} a ext:SubmissionDocument .
        ?physicalUri nie:dataSource ${sparqlEscapeUri(logicalFile)} .
      }
    }
  `);
  const physicalUri = response.results.bindings[0].physicalUri.value;
  const path = physicalUri.replace('share://', '/share/');

  try {
    await fs.unlink(path);
  } catch (e) {
    console.log(`Failed to delete TTL file <${physicalUri}> on disk: \n ${e}`);
    throw e;
  }

  try {
    await update(`
      DELETE WHERE {
          ${sparqlEscapeUri(physicalUri)} ?p1 ?o1 .
          ${sparqlEscapeUri(logicalUri)} ?p2 ?o2 .
      }
    `);
  } catch (e) {
    console.log(`Failed to delete TTL resource <${logicalFile}> in triplestore: \n ${e}`);
    throw e;
  }
}

export {
  PUBLIC_FILES_GRAPH,
  getFileContent,
  getFileContentPhysical,
  insertTtlFile,
  updateTtlFile,
  deleteTtlFile
}
