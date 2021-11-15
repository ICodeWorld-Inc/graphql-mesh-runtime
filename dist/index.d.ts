import { GetMeshSourceOptions, MeshHandler, MeshSource, YamlConfig } from '@graphql-mesh/types';
export default class GraphQLHandler implements MeshHandler {
    private config;
    private baseDir;
    private cache;
    private nonExecutableSchema;
    private importFn;
    constructor({ config, baseDir, cache, store, importFn }: GetMeshSourceOptions<YamlConfig.GraphQLHandler>);
    getMeshSource(): Promise<MeshSource>;
}
