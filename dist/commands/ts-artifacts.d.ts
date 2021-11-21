import { Logger, RawSourceOutput, YamlConfig } from '@graphql-mesh/types';
import { GraphQLSchema } from 'graphql';
import { Source } from '@graphql-tools/utils';
import ts from 'typescript';
export declare function generateTsArtifacts({ unifiedSchema, rawSources, mergerType, documents, flattenTypes, importedModulesSet, baseDir, meshConfigCode, logger, sdkConfig, }: {
    unifiedSchema: GraphQLSchema;
    rawSources: RawSourceOutput[];
    mergerType: string;
    documents: Source[];
    flattenTypes: boolean;
    importedModulesSet: Set<string>;
    baseDir: string;
    meshConfigCode: string;
    logger: Logger;
    sdkConfig: YamlConfig.SDKConfig;
}): Promise<void>;
export declare function compileTS(tsFilePath: string, module: ts.ModuleKind, outputFilePaths: string[]): void;
