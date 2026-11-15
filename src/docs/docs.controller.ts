import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { respond } from '../http/http-helpers.js';
import { OPENAPI_DOCUMENT } from './openapi.js';
import { SWAGGER_ASSETS } from './swagger-assets.js';
import { SWAGGER_INITIALIZER } from './swagger-initializer.js';
import { SWAGGER_PAGE } from './swagger-page.js';

const require = createRequire(import.meta.url);
const assetsDirectory = dirname(require.resolve('swagger-ui-dist/package.json'));
const assets = new Map(Object.entries(SWAGGER_ASSETS).map(([path, asset]) => [path, { contentType: asset.contentType, content: readFileSync(join(assetsDirectory, asset.file)) }]));

export function serveDocumentation(method: string | undefined, path: string, response: ServerResponse): boolean {
  if (method !== 'GET') return false;
  if (path === '/') {
    response.writeHead(302, { location: '/docs', 'cache-control': 'no-store' });
    response.end();
  } else if (path === '/docs' || path === '/docs/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(SWAGGER_PAGE);
  } else if (path === '/api/openapi.json') {
    respond(response, 200, OPENAPI_DOCUMENT);
  } else if (path === '/docs/initializer.js') {
    response.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
    response.end(SWAGGER_INITIALIZER);
  } else {
    const asset = assets.get(path);
    if (!asset) return false;
    response.writeHead(200, { 'content-type': asset.contentType, 'cache-control': 'public, max-age=3600' });
    response.end(asset.content);
  }
  return true;
}
