import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { handleApi } from '../../../lib/ai.mjs';
import config from '../../../public/search_config.json';
import schema from '../../../public/search_filters.schema.json';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  const user = await getChatGPTUser();
  return handleApi(request, env, user?.userId, config, schema);
}
export const GET = handle;
export const POST = handle;
