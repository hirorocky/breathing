interface Env {
  BREATHING_API: { fetch: typeof fetch };
}

type PagesHandler = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

/** Pages から breathing-api Worker へ同一オリジンの /api/* を転送する */
export const onRequest: PagesHandler = async (context) => {
  return context.env.BREATHING_API.fetch(context.request);
};
