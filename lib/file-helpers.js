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

export {
  FILE_GRAPH,
  getFileContent
}
