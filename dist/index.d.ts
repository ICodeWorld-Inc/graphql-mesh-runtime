import { findAndParseConfig } from './config';
import { generateTsArtifacts } from './commands/ts-artifacts';
import { serveMesh } from './commands/serve/serve';
export { generateTsArtifacts, serveMesh, findAndParseConfig };
export declare function graphqlMesh(): Promise<{
    [x: string]: unknown;
    port: number;
    prod: boolean;
    validate: boolean;
    _: (string | number)[];
    $0: string;
} | {
    [x: string]: unknown;
    port: number;
    prod: boolean;
    validate: boolean;
    _: (string | number)[];
    $0: string;
}>;
