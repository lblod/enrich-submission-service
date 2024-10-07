import * as env from 'env-var';

export const GRAPH_TEMPLATE = env.get('GRAPH_TEMPLATE')
  .example('http://mu.semte.ch/graphs/organizations/~ORGANIZATION_ID~/LoketLB-toezichtGebruiker')
  .default('http://mu.semte.ch/graphs/organizations/~ORGANIZATION_ID~/LoketLB-toezichtGebruiker')
  .asUrlString();

export const OVERRULE_ORG_CHECK_ON_READ = env.get('OVERRULE_ORG_CHECK_ON_READ')
  .example('false')
  .default('false')
  .asBool();

(function checkEnvVars() {
  if (!/~ORGANIZATION_ID~/g.test(GRAPH_TEMPLATE))
    throw new Error(`The GRAPH_TEMPLATE environment variable ${GRAPH_TEMPLATE} does not contain a ~ORGANIZATION_ID~.`);
})();
