import { RequestHandler } from 'express';
import { Source } from '@graphql-tools/utils';
import { Logger } from '@graphql-mesh/types';
export declare const playgroundMiddlewareFactory: ({ baseDir, documents, graphqlPath, logger, }: {
    baseDir: string;
    documents: Source[];
    graphqlPath: string;
    logger: Logger;
}) => RequestHandler;
