-- Run this in your Supabase SQL Editor (supabase.com → your project → SQL Editor)

-- Items table (charges, subscriptions, receipts)
create table items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  note text default '',
  section text not null check (section in ('pending','upcoming','subscriptions','paid','missing')),
  item_date date,
  amount numeric(10,2) default 0,
  created_at timestamptz default now()
);

-- Item settings (status, next bill, monthly price, files)
create table item_settings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  item_id uuid references items(id) on delete cascade not null,
  status text default 'active',
  nextbill date,
  monthly_price numeric(10,2),
  files_json text default '[]',
  unique(user_id, item_id)
);

-- User plans (free or pro)
create table user_plans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade unique not null,
  plan text default 'free' check (plan in ('free','pro')),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz default now()
);

-- Row Level Security: users can only see their own data
alter table items enable row level security;
alter table item_settings enable row level security;
alter table user_plans enable row level security;

create policy "Users see own items" on items
  for all using (auth.uid() = user_id);

create policy "Users see own settings" on item_settings
  for all using (auth.uid() = user_id);

create policy "Users see own plan" on user_plans
  for all using (auth.uid() = user_id);

-- Auto-create a free plan when a user signs up
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into user_plans (user_id, plan) values (new.id, 'free');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
