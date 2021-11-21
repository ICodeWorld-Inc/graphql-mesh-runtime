import { ConfigProcessOptions } from '@graphql-mesh/config';
import { YamlConfig } from '@graphql-mesh/types';
export declare function validateConfig(config: any): asserts config is YamlConfig.Config;
export declare function findAndParseConfig(options?: {
    configName?: string;
} & ConfigProcessOptions): Promise<import("@graphql-mesh/config").ProcessedConfig>;
