import { UrlLoader } from '@graphql-tools/url-loader';
import { GraphQLSchema, buildSchema, Kind, buildASTSchema } from 'graphql';
import { introspectSchema } from '@graphql-tools/wrap';
import { getCachedFetch, loadFromModuleExportExpression, readFileOrUrl, getInterpolatedHeadersFactory, getInterpolatedStringFactory, getHeadersObject } from '@graphql-mesh/utils';
import { PredefinedProxyOptions } from '@graphql-mesh/store';
import { env } from 'process';

class GraphQLHandler {
    constructor({ config, baseDir, cache, store, importFn }) {
        this.config = config;
        this.baseDir = baseDir;
        this.cache = cache;
        this.nonExecutableSchema = store.proxy('schema.graphql', PredefinedProxyOptions.GraphQLSchemaWithDiffing);
        this.importFn = importFn;
    }
    async getMeshSource() {
        const { endpoint, schemaHeaders: configHeaders, introspection } = this.config;
        const customFetch = getCachedFetch(this.cache);
        if (endpoint.endsWith('.js') || endpoint.endsWith('.ts')) {
            // Loaders logic should be here somehow
            const schemaOrStringOrDocumentNode = await loadFromModuleExportExpression(endpoint, { cwd: this.baseDir, defaultExportName: 'default', importFn: this.importFn });
            let schema;
            if (schemaOrStringOrDocumentNode instanceof GraphQLSchema) {
                schema = schemaOrStringOrDocumentNode;
            }
            else if (typeof schemaOrStringOrDocumentNode === 'string') {
                schema = buildSchema(schemaOrStringOrDocumentNode);
            }
            else if (typeof schemaOrStringOrDocumentNode === 'object' &&
                (schemaOrStringOrDocumentNode === null || schemaOrStringOrDocumentNode === void 0 ? void 0 : schemaOrStringOrDocumentNode.kind) === Kind.DOCUMENT) {
                schema = buildASTSchema(schemaOrStringOrDocumentNode);
            }
            else {
                throw new Error(`Provided file '${endpoint} exports an unknown type: ${typeof schemaOrStringOrDocumentNode}': expected GraphQLSchema, SDL or DocumentNode.`);
            }
            return {
                schema,
            };
        }
        else if (endpoint.endsWith('.graphql')) {
            const rawSDL = await readFileOrUrl(endpoint, {
                cwd: this.baseDir,
                allowUnknownExtensions: true,
            });
            const schema = buildSchema(rawSDL);
            return {
                schema,
            };
        }
        const urlLoader = new UrlLoader();
        const getExecutorForParams = (params, headersFactory, endpointFactory) => {
            const resolverData = {
                root: {},
                args: params.variables,
                context: params.context,
                env,
            };
            const headers = getHeadersObject(headersFactory(resolverData));
            const endpoint = endpointFactory(resolverData);
            return urlLoader.getExecutorAsync(endpoint, {
                customFetch,
                ...this.config,
                subscriptionsProtocol: this.config.subscriptionsProtocol,
                headers,
                requestCredentials: 'omit'
            });
        };
        let schemaHeaders = typeof configHeaders === 'string'
            ? await loadFromModuleExportExpression(configHeaders, {
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
        const schemaHeadersFactory = getInterpolatedHeadersFactory(schemaHeaders || {});
        async function introspectionExecutor(params) {
            const executor = await getExecutorForParams(params, schemaHeadersFactory, () => endpoint);
            return executor(params);
        }
        const operationHeadersFactory = getInterpolatedHeadersFactory(this.config.operationHeaders);
        const endpointFactory = getInterpolatedStringFactory(endpoint);
        const nonExecutableSchema = await this.nonExecutableSchema.getWithSet(async () => {
            const schemaFromIntrospection = await (introspection
                ? urlLoader
                    .handleSDL(introspection, customFetch, {
                    ...this.config,
                    subscriptionsProtocol: this.config.subscriptionsProtocol,
                    headers: schemaHeaders,
                })
                    .then(({ schema }) => schema)
                : introspectSchema(introspectionExecutor));
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

export default GraphQLHandler;
