/** OpenAI's domain check for the ChatGPT plugin listing: the portal shows a token, we serve exactly that token. */
export const dynamic = "force-dynamic";

export const GET = () => {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
  return token
    ? new Response(token, { headers: { "content-type": "text/plain; charset=utf-8" } })
    : new Response("Not found", { status: 404 });
};
