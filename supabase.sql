-- Supabaseの「SQL Editor」に貼って Run
create table profiles(id uuid primary key references auth.users on delete cascade, name text, code text unique default substr(md5(random()::text),1,6), equity numeric default 1000000, updated_at timestamptz default now());
create table game_state(user_id uuid primary key references auth.users on delete cascade, data jsonb not null, updated_at timestamptz default now());
create table friends(user_id uuid references auth.users on delete cascade, friend_id uuid references auth.users on delete cascade, primary key(user_id,friend_id));
alter table profiles enable row level security; alter table game_state enable row level security; alter table friends enable row level security;
create policy "自分とフレンドのprofile" on profiles for select using (auth.uid()=id or exists(select 1 from friends f where f.user_id=auth.uid() and f.friend_id=profiles.id));
create policy "自分のprofile更新" on profiles for update using (auth.uid()=id);
create policy "自分のstate" on game_state for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "自分のフレンド" on friends for select using (auth.uid()=user_id);
create function handle_new_user() returns trigger language plpgsql security definer as $$ begin insert into profiles(id,name) values (new.id, coalesce(new.raw_user_meta_data->>'name','player')); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
create function add_friend(c text) returns text language plpgsql security definer as $$
declare fid uuid; begin
  select id into fid from profiles where code=lower(trim(c));
  if fid is null then return 'notfound'; end if;
  if fid=auth.uid() then return 'self'; end if;
  insert into friends values (auth.uid(),fid),(fid,auth.uid()) on conflict do nothing; return 'ok'; end $$;
