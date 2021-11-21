import { getMesh } from '@graphql-mesh/runtime';
import { RequestHandler } from 'express';
export declare const graphqlHandler: (mesh$: ReturnType<typeof getMesh>) => RequestHandler;
