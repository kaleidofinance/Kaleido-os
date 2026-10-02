-- Waitlist X: "like & repost the DefiLlama listing post" task (+100 kPoint).
alter table public.waitlist
  add column if not exists x_llama_at timestamptz;

comment on column public.waitlist.x_llama_at is
  'Attested like + repost completion for the DefiLlama listing announcement; +100 kPoint.';
