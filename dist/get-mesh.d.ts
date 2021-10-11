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
    contextBuilder: (initialContextValue?: any) => Promise<Record<string, any>>;
    destroy: () => void;
    pubsub: MeshPubSub;
    cache: KeyValueCache;
    liveQueryStore: InMemoryLiveQueryStore;
}
export declare function getMesh(options: GetMeshOptions): Promise<MeshInstance>;
