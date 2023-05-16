import * as env from 'env-var';

export const SINGLE_GRAPH_MODE = env.get('SINGLE_GRAPH_MODE')
  .default('false')
  .asBool();
export const SOURCE_GRAPH = env.get('SOURCE_GRAPH')
  .default('http://mu.semte.ch/graphs/organizations/141d9d6b-54af-4d17-b313-8d1c30bc3f5b') // ABB
  .asUrlString();

export const GRAPH_TEMPLATE = env.get('GRAPH_TEMPLATE')
  .example('http://mu.semte.ch/graphs/organizations/~ORGANIZATION_ID~/LoketLB-toezichtGebruiker')
  .default('http://mu.semte.ch/graphs/organizations/~ORGANIZATION_ID~/LoketLB-toezichtGebruiker')
  .asUrlString();

(function checkEnvVars() {
  if (!/~ORGANIZATION_ID~/g.test(GRAPH_TEMPLATE))
    throw new Error(`The GRAPH_TEMPLATE environment variable ${GRAPH_TEMPLATE} does not contain a ~ORGANIZATION_ID~.`);
})();
