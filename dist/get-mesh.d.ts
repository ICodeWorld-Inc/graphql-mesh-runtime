import { GraphQLSchema } from 'graphql';
import { ExecuteMeshFn, GetMeshOptions, Requester, SubscribeMeshFn } from './types';
import { MeshPubSub, KeyValueCache, RawSourceOutput } from '@graphql-mesh/types';
import { InMemoryLiveQueryStore } from '@n1ru4l/in-memory-live-query-store';
export interface MeshInstance {
    execute: ExecuteMeshFn;
    subscribe: SubscribeMeshFn;
    schema: GraphQLSchema;
    rawSources: RawSourceOutput[];
    sdkRequester: Requester;
    destroy: () => void;
    pubsub: MeshPubSub;
    cache: KeyValueCache;
    liveQueryStore: InMemoryLiveQueryStore;
    /**
     * @deprecated
     * contextBuilder has no effect in the provided context anymore.
     * It will be removed in the next version
     */
    contextBuilder: (ctx: any) => Promise<any>;
    addCustomContextBuilder: (builder: CustomContextBuilders) => void;
}
declare type CustomContextBuilders = () => Promise<{
    [key: string]: any;
}>;
export declare function getMesh(options: GetMeshOptions): Promise<MeshInstance>;
export {};
