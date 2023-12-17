import { getOperationAST, print, subscribe } from 'graphql';
import { composeResolvers } from '@graphql-tools/resolvers-composition';
import { addResolversToSchema } from '@graphql-tools/schema';
import { extractResolvers, DefaultLogger, groupTransforms, applySchemaTransforms, jitExecutorFactory, getInterpolatedStringFactory, ensureDocumentNode, AggregateError } from '@graphql-mesh/utils';
import { env } from 'process';
import { InMemoryLiveQueryStore } from '@n1ru4l/in-memory-live-query-store';
import { delegateToSchema } from '@graphql-tools/delegate';
import { batchDelegateToSchema } from '@graphql-tools/batch-delegate';
import { WrapQuery } from '@graphql-tools/wrap';
import { inspect, parseSelectionSet, isDocumentNode } from '@graphql-tools/utils';

function applyResolversHooksToResolvers(resolvers, pubsub, meshContext) {
    return composeResolvers(resolvers, {
        '*.*': (originalResolver) => async (...resolverArgs) => {
            let resolverData;
            let isArgsInResolversArgs;
            if (resolverArgs.length === 3) {
                resolverData = {
                    root: resolverArgs[0],
                    context: resolverArgs[1] || {},
                    info: resolverArgs[2],
                    env,
                };
                isArgsInResolversArgs = false;
            }
            else if (resolverArgs.length === 4) {
                resolverData = {
                    root: resolverArgs[0],
                    args: resolverArgs[1],
                    context: resolverArgs[2] || {},
                    info: resolverArgs[3],
                    env,
                };
                isArgsInResolversArgs = true;
            }
            else {
                throw new Error('Unexpected resolver params given');
            }
            pubsub.publish('resolverCalled', { resolverData });
            const finalContext = Object.assign(resolverData.context || {}, meshContext);
            try {
                const result = await (isArgsInResolversArgs
                    ? originalResolver(resolverData.root, resolverData.args, finalContext, resolverData.info)
                    : originalResolver(resolverData.root, finalContext, resolverData.info));
                pubsub.publish('resolverDone', { resolverData, result });
                return result;
            }
            catch (error) {
                pubsub.publish('resolverError', { resolverData, error });
                throw error;
            }
        },
    });
}
function applyResolversHooksToSchema(schema, pubsub, meshContext) {
    const sourceResolvers = extractResolvers(schema);
    return addResolversToSchema({
        schema,
        resolvers: applyResolversHooksToResolvers(sourceResolvers, pubsub, meshContext),
        updateResolversInPlace: true,
    });
}

const MESH_CONTEXT_SYMBOL = Symbol('isMeshContext');
const MESH_API_CONTEXT_SYMBOL = Symbol('isMeshAPIContext');

/* eslint-disable no-unused-expressions */
async function getMesh(options) {
    var _a;
    const rawSources = [];
    const customContextBuilders = [];
    const addCustomContextBuilder = (contextBuilder) => {
        customContextBuilders.push(contextBuilder);
    };
    const mergeContext = async (context) => {
        const allCustomContexts = await Promise.all(customContextBuilders.map(builder => {
            return builder();
        }));
        return Object.assign(context, ...allCustomContexts);
    };
    const { pubsub, cache, logger = new DefaultLogger('🕸️') } = options;
    const getMeshLogger = logger.child('GetMesh');
    getMeshLogger.debug(`Getting subschemas from source handlers`);
    let failed = false;
    await Promise.allSettled(options.sources.map(async (apiSource) => {
        const apiName = apiSource.name;
        const sourceLogger = logger.child(apiName);
        sourceLogger.debug(`Generating the schema`);
        try {
            const source = await apiSource.handler.getMeshSource();
            sourceLogger.debug(`The schema has been generated successfully`);
            let apiSchema = source.schema;
            sourceLogger.debug(`Analyzing transforms`);
            const { wrapTransforms, noWrapTransforms } = groupTransforms(apiSource.transforms);
            if (noWrapTransforms === null || noWrapTransforms === void 0 ? void 0 : noWrapTransforms.length) {
                sourceLogger.debug(`${noWrapTransforms.length} bare transforms found and applying`);
                apiSchema = applySchemaTransforms(apiSchema, source, null, noWrapTransforms);
            }
            rawSources.push({
                name: apiName,
                schema: apiSchema,
                executor: source.executor,
                transforms: wrapTransforms,
                contextVariables: source.contextVariables || [],
                handler: apiSource.handler,
                batch: 'batch' in source ? source.batch : true,
                merge: apiSource.merge,
            });
        }
        catch (e) {
            sourceLogger.error(`Failed to generate schema: ${e.message || e}`);
            failed = true;
        }
    }));
    if (failed) {
        throw new Error(`Schemas couldn't be generated successfully. Check for the logs by running Mesh with DEBUG=1 environmental variable to get more verbose output.`);
    }
    getMeshLogger.debug(`Schemas have been generated by the source handlers`);
    getMeshLogger.debug(`Merging schemas using the defined merging strategy.`);
    let unifiedSchema = await options.merger.getUnifiedSchema({
        rawSources,
        typeDefs: options.additionalTypeDefs,
        resolvers: options.additionalResolvers,
        transforms: options.transforms,
    });
    getMeshLogger.debug(`Creating JIT Executor`);
    const jitExecutor = jitExecutorFactory(unifiedSchema, 'unified', logger.child('JIT Executor'));
    getMeshLogger.debug(`Creating Live Query Store`);
    const liveQueryStore = new InMemoryLiveQueryStore({
        includeIdentifierExtension: true,
        execute: (args) => {
            const { document, contextValue, variableValues, rootValue, operationName } = args;
            const operationAst = getOperationAST(document, operationName);
            if (!operationAst) {
                throw new Error(`Operation ${operationName} cannot be found!`);
            }
            const operationType = operationAst.operation;
            return jitExecutor({
                document,
                context: contextValue,
                variables: variableValues,
                operationName,
                rootValue,
                operationType,
            });
        },
    });
    const liveQueryInvalidationFactoryMap = new Map();
    (_a = options.liveQueryInvalidations) === null || _a === void 0 ? void 0 : _a.forEach(liveQueryInvalidation => {
        const rawInvalidationPaths = liveQueryInvalidation.invalidate;
        const factories = rawInvalidationPaths.map(rawInvalidationPath => getInterpolatedStringFactory(rawInvalidationPath));
        liveQueryInvalidationFactoryMap.set(liveQueryInvalidation.field, factories);
    });
    getMeshLogger.debug(`Creating event listener (resolverDone) for Live Query Store`);
    pubsub.subscribe('resolverDone', ({ result, resolverData }) => {
        var _a, _b;
        if (((_a = resolverData === null || resolverData === void 0 ? void 0 : resolverData.info) === null || _a === void 0 ? void 0 : _a.parentType) && ((_b = resolverData === null || resolverData === void 0 ? void 0 : resolverData.info) === null || _b === void 0 ? void 0 : _b.fieldName)) {
            const path = `${resolverData.info.parentType.name}.${resolverData.info.fieldName}`;
            if (liveQueryInvalidationFactoryMap.has(path)) {
                const invalidationPathFactories = liveQueryInvalidationFactoryMap.get(path);
                const invalidationPaths = invalidationPathFactories.map(invalidationPathFactory => invalidationPathFactory({ ...resolverData, result }));
                liveQueryStore.invalidate(invalidationPaths);
            }
        }
    });
    getMeshLogger.debug(`Building Mesh Context`);
    const meshContext = {
        pubsub,
        cache,
        liveQueryStore,
        [MESH_CONTEXT_SYMBOL]: true,
    };
    getMeshLogger.debug(`Attaching in-context SDK, pubsub, cache and liveQueryStore to the context`);
    const sourceMap = unifiedSchema.extensions.sourceMap;
    await Promise.all(rawSources.map(async (rawSource) => {
        const rawSourceLogger = logger.child(`${rawSource.name}`);
        const rawSourceContext = {
            rawSource,
            [MESH_API_CONTEXT_SYMBOL]: true,
        };
        const transformedSchema = sourceMap.get(rawSource);
        const rootTypes = {
            query: transformedSchema.getQueryType(),
            mutation: transformedSchema.getMutationType(),
            subscription: transformedSchema.getSubscriptionType(),
        };
        rawSourceLogger.debug(`Generating In Context SDK`);
        for (const operationType in rootTypes) {
            const rootType = rootTypes[operationType];
            if (rootType) {
                rawSourceContext[rootType.name] = {};
                const rootTypeFieldMap = rootType.getFields();
                for (const fieldName in rootTypeFieldMap) {
                    const rootTypeField = rootTypeFieldMap[fieldName];
                    const inContextSdkLogger = rawSourceLogger.child(`InContextSDK.${rootType.name}.${fieldName}`);
                    rawSourceContext[rootType.name][fieldName] = async ({ root, args, context, info, selectionSet, key, argsFromKeys, valuesFromResults, }) => {
                        inContextSdkLogger.debug(`Called with
- root: ${inspect(root)}
- args: ${inspect(args)}
- key: ${inspect(key)}`);
                        const commonDelegateOptions = {
                            schema: rawSource,
                            rootValue: root,
                            operation: operationType,
                            fieldName,
                            returnType: rootTypeField.type,
                            context,
                            transformedSchema,
                            info,
                        };
                        if (key && argsFromKeys) {
                            const batchDelegationOptions = {
                                ...commonDelegateOptions,
                                key,
                                argsFromKeys,
                                valuesFromResults,
                            };
                            if (selectionSet) {
                                const selectionSetFactory = normalizeSelectionSetParamOrFactory(selectionSet);
                                const path = [fieldName];
                                const wrapQueryTransform = new WrapQuery(path, selectionSetFactory, identical);
                                batchDelegationOptions.transforms = [wrapQueryTransform];
                            }
                            return batchDelegateToSchema(batchDelegationOptions);
                        }
                        else {
                            const options = {
                                ...commonDelegateOptions,
                                args,
                            };
                            if (selectionSet) {
                                const selectionSetFactory = normalizeSelectionSetParamOrFactory(selectionSet);
                                const path = [fieldName];
                                const wrapQueryTransform = new WrapQuery(path, selectionSetFactory, identical);
                                options.transforms = [wrapQueryTransform];
                            }
                            const result = await delegateToSchema(options);
                            if (valuesFromResults) {
                                return valuesFromResults(result);
                            }
                            return result;
                        }
                    };
                }
            }
        }
        meshContext[rawSource.name] = rawSourceContext;
    }));
    getMeshLogger.debug(`Attaching resolver hooks to the unified schema`);
    unifiedSchema = applyResolversHooksToSchema(unifiedSchema, pubsub, meshContext);
    const executionLogger = logger.child(`Execute`);
    const EMPTY_ROOT_VALUE = {};
    const EMPTY_CONTEXT_VALUE = {};
    const EMPTY_VARIABLES_VALUE = {};
    async function meshExecute(document, variableValues = EMPTY_VARIABLES_VALUE, contextValue = EMPTY_CONTEXT_VALUE, rootValue = EMPTY_ROOT_VALUE, operationName) {
        var _a;
        const printedDocument = typeof document === 'string' ? document : print(document);
        const documentNode = ensureDocumentNode(document);
        if (!operationName) {
            const operationAst = getOperationAST(documentNode);
            operationName = (_a = operationAst.name) === null || _a === void 0 ? void 0 : _a.value;
        }
        const operationLogger = executionLogger.child(operationName || 'UnnamedOperation');
        contextValue = await mergeContext(contextValue);
        const executionParams = {
            document: documentNode,
            contextValue,
            rootValue,
            variableValues,
            schema: unifiedSchema,
            operationName,
        };
        operationLogger.debug(`Execution started with
${inspect({
            ...(operationName ? {} : { query: printedDocument }),
            ...(rootValue ? { rootValue } : {}),
            ...(variableValues ? { variableValues } : {}),
        })}`);
        const executionResult = await liveQueryStore.execute(executionParams);
        operationLogger.debug(`Execution done with
${inspect({
            ...(operationName ? {} : { query: printedDocument }),
            ...executionResult,
        })}`);
        return executionResult;
    }
    const subscriberLogger = logger.child(`meshSubscribe`);
    async function meshSubscribe(document, variableValues = EMPTY_VARIABLES_VALUE, contextValue = EMPTY_CONTEXT_VALUE, rootValue = EMPTY_ROOT_VALUE, operationName) {
        var _a;
        const printedDocument = typeof document === 'string' ? document : print(document);
        const documentNode = ensureDocumentNode(document);
        if (!operationName) {
            const operationAst = getOperationAST(documentNode);
            operationName = (_a = operationAst.name) === null || _a === void 0 ? void 0 : _a.value;
        }
        const operationLogger = subscriberLogger.child(operationName || 'UnnamedOperation');
        contextValue = await mergeContext(contextValue);
        const executionParams = {
            document: documentNode,
            contextValue,
            rootValue,
            variableValues,
            schema: unifiedSchema,
            operationName,
        };
        operationLogger.debug(`Subscription started with
${inspect({
            ...(rootValue ? {} : { rootValue }),
            ...(variableValues ? {} : { variableValues }),
            ...(operationName ? {} : { query: printedDocument }),
        })}`);
        const executionResult = await subscribe(executionParams);
        return executionResult;
    }
    class GraphQLMeshSdkError extends AggregateError {
        constructor(errors, document, variables, data) {
            var _a;
            super(errors, `GraphQL Mesh SDK ${getOperationAST(document).operation} ${((_a = getOperationAST(document).name) === null || _a === void 0 ? void 0 : _a.value) || ''} failed!`);
            this.document = document;
            this.variables = variables;
            this.data = data;
        }
    }
    const localRequester = async (document, variables, contextValue, rootValue, operationName) => {
        const executionResult = await meshExecute(document, variables, contextValue, rootValue, operationName);
        if ('data' in executionResult || 'errors' in executionResult) {
            if (executionResult.data && !executionResult.errors) {
                return executionResult.data;
            }
            else {
                logger.error(`GraphQL Mesh SDK failed to execute:
        ${inspect({
                    query: print(document),
                    variables,
                })}`);
                throw new GraphQLMeshSdkError(executionResult.errors, document, variables, executionResult.data);
            }
        }
        else {
            throw new Error('Not implemented');
        }
    };
    return {
        execute: meshExecute,
        subscribe: meshSubscribe,
        schema: unifiedSchema,
        rawSources,
        sdkRequester: localRequester,
        cache,
        pubsub,
        destroy: () => pubsub.publish('destroy', undefined),
        liveQueryStore,
        contextBuilder: async (ctx) => ctx || {},
        addCustomContextBuilder,
    };
}
function normalizeSelectionSetParam(selectionSetParam) {
    if (typeof selectionSetParam === 'string') {
        return parseSelectionSet(selectionSetParam);
    }
    if (isDocumentNode(selectionSetParam)) {
        return parseSelectionSet(print(selectionSetParam));
    }
    return selectionSetParam;
}
function normalizeSelectionSetParamOrFactory(selectionSetParamOrFactory) {
    return function getSelectionSet(subtree) {
        if (typeof selectionSetParamOrFactory === 'function') {
            const selectionSetParam = selectionSetParamOrFactory(subtree);
            return normalizeSelectionSetParam(selectionSetParam);
        }
        else {
            return normalizeSelectionSetParam(selectionSetParamOrFactory);
        }
    };
}
function identical(val) {
    return val;
}

export { applyResolversHooksToResolvers, applyResolversHooksToSchema, getMesh };
