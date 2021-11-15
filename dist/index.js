'use strict';

const urlLoader = require('@graphql-tools/url-loader');
const graphql = require('graphql');
const wrap = require('@graphql-tools/wrap');
const utils = require('@graphql-mesh/utils');
const store = require('@graphql-mesh/store');
const process = require('process');

class GraphQLHandler {
    constructor({ config, baseDir, cache, store: store$1, importFn }) {
        this.config = config;
        this.baseDir = baseDir;
        this.cache = cache;
        this.nonExecutableSchema = store$1.proxy('schema.graphql', store.PredefinedProxyOptions.GraphQLSchemaWithDiffing);
        this.importFn = importFn;
    }
    async getMeshSource() {
        const { endpoint, schemaHeaders: configHeaders, introspection } = this.config;
        const customFetch = utils.getCachedFetch(this.cache);
        if (endpoint.endsWith('.js') || endpoint.endsWith('.ts')) {
            // Loaders logic should be here somehow
            const schemaOrStringOrDocumentNode = await utils.loadFromModuleExportExpression(endpoint, { cwd: this.baseDir, defaultExportName: 'default', importFn: this.importFn });
            let schema;
            if (schemaOrStringOrDocumentNode instanceof graphql.GraphQLSchema) {
                schema = schemaOrStringOrDocumentNode;
            }
            else if (typeof schemaOrStringOrDocumentNode === 'string') {
                schema = graphql.buildSchema(schemaOrStringOrDocumentNode);
            }
            else if (typeof schemaOrStringOrDocumentNode === 'object' &&
                (schemaOrStringOrDocumentNode === null || schemaOrStringOrDocumentNode === void 0 ? void 0 : schemaOrStringOrDocumentNode.kind) === graphql.Kind.DOCUMENT) {
                schema = graphql.buildASTSchema(schemaOrStringOrDocumentNode);
            }
            else {
                throw new Error(`Provided file '${endpoint} exports an unknown type: ${typeof schemaOrStringOrDocumentNode}': expected GraphQLSchema, SDL or DocumentNode.`);
            }
            return {
                schema,
            };
        }
        else if (endpoint.endsWith('.graphql')) {
            const rawSDL = await utils.readFileOrUrl(endpoint, {
                cwd: this.baseDir,
                allowUnknownExtensions: true,
            });
            const schema = graphql.buildSchema(rawSDL);
            return {
                schema,
            };
        }
        const urlLoader$1 = new urlLoader.UrlLoader();
        const getExecutorForParams = (params, headersFactory, endpointFactory) => {
            const resolverData = {
                root: {},
                args: params.variables,
                context: params.context,
                env: process.env,
            };
            const headers = utils.getHeadersObject(headersFactory(resolverData));
            const endpoint = endpointFactory(resolverData);
            return urlLoader$1.getExecutorAsync(endpoint, {
                customFetch,
                ...this.config,
                subscriptionsProtocol: this.config.subscriptionsProtocol,
                headers,
                requestCredentials: 'omit'
            });
        };
        let schemaHeaders = typeof configHeaders === 'string'
            ? await utils.loadFromModuleExportExpression(configHeaders, {
                cwd: this.baseDir,
                defaultExportName: 'default',
                importFn: this.importFn,
            })
            : configHeaders;
        if (typeof schemaHeaders === 'function') {
            schemaHeaders = schemaHeaders();
        }
        if (schemaHeaders && 'then' in schemaHeaders) {
            schemaHeaders = await schemaHeaders;
        }
        const schemaHeadersFactory = utils.getInterpolatedHeadersFactory(schemaHeaders || {});
        async function introspectionExecutor(params) {
            const executor = await getExecutorForParams(params, schemaHeadersFactory, () => endpoint);
            return executor(params);
        }
        const operationHeadersFactory = utils.getInterpolatedHeadersFactory(this.config.operationHeaders);
        const endpointFactory = utils.getInterpolatedStringFactory(endpoint);
        const nonExecutableSchema = await this.nonExecutableSchema.getWithSet(async () => {
            const schemaFromIntrospection = await (introspection
                ? urlLoader$1
                    .handleSDL(introspection, customFetch, {
                    ...this.config,
                    subscriptionsProtocol: this.config.subscriptionsProtocol,
                    headers: schemaHeaders,
                })
                    .then(({ schema }) => schema)
                : wrap.introspectSchema(introspectionExecutor));
            return schemaFromIntrospection;
        });
        return {
            schema: nonExecutableSchema,
            executor: async (params) => {
                params = deleteWarp(params);
                const executor = await getExecutorForParams(params, operationHeadersFactory, endpointFactory);
                return executor(params);
            },
            batch: 'batch' in this.config ? this.config.batch : true,
        };
    }
}
// 兼容the graphql op没有 __typename
function deleteWarp(params) {
    try {
        if (params.document.definitions[0].selectionSet.selections[0].name.value === '__typename') {
            delete params.document.definitions[0].selectionSet.selections[0];
        }
        return params;
    }
    catch (error) {
        console.warn(error);
        return params;
    }
}

module.exports = GraphQLHandler;
