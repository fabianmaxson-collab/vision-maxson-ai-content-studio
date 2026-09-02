import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

export interface Bindings {
  ENVIRONMENT: 'local' | 'preview' | 'staging' | 'production';
  RELEASE_VERSION: string;
  ASSETS: Fetcher;
}

export function createApp() {
  const app = new Hono<{ Bindings: Bindings }>();

  app.use('*', secureHeaders());

  app.get('/api/v1/health', (context) =>
    context.json(
      {
        status: 'ok',
        service: 'vision-maxson-api',
        environment: context.env.ENVIRONMENT,
        version: context.env.RELEASE_VERSION,
      },
      200,
      { 'Cache-Control': 'no-store' },
    ),
  );

  app.notFound((context) => {
    if (context.req.path.startsWith('/api/')) {
      return context.json(
        {
          type: 'https://vision.directormaxson.com/problems/not-found',
          title: 'Not Found',
          status: 404,
          detail: 'The requested API resource does not exist.',
        },
        404,
        { 'Cache-Control': 'no-store' },
      );
    }

    return context.env.ASSETS.fetch(context.req.raw);
  });

  app.onError((error, context) => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'unhandled_request_error',
        method: context.req.method,
        path: context.req.path,
        message: error.message,
      }),
    );

    return context.json(
      {
        type: 'https://vision.directormaxson.com/problems/internal-error',
        title: 'Internal Server Error',
        status: 500,
      },
      500,
      { 'Cache-Control': 'no-store' },
    );
  });

  return app;
}
