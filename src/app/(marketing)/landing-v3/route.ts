export function GET(request: Request) {
  return new Response(null, {
    status: 308,
    headers: { Location: `/${new URL(request.url).search}` },
  });
}
