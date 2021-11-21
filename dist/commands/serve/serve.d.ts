import 'json-bigint-patch';
import { Server } from 'http';
import { MeshInstance } from '@graphql-mesh/runtime';
import { YamlConfig, Logger } from '@graphql-mesh/types';
import { Source } from '@graphql-tools/utils';
export interface ServeMeshOptions {
    baseDir: string;
    getBuiltMesh: () => Promise<MeshInstance>;
    logger: Logger;
    rawConfig: YamlConfig.Config;
    documents: Source[];
    argsPort?: number;
}
export declare function serveMesh({ baseDir, argsPort, getBuiltMesh, logger, rawConfig, documents }: ServeMeshOptions): Promise<{
    mesh: MeshInstance;
    httpServer: Server;
    app: import("express-serve-static-core").Express;
    readyFlag: boolean;
    logger: Logger;
}>;
