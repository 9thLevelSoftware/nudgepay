-- Local-dev seed: Chancey org + 5 members. Uses fixed emails for predictable login.
-- diskin@chancey.test / password123 is the owner account for manual smoke tests.
do $$
declare
  v_org uuid;
  v_user_id uuid;
  v_email text;
  v_names text[] := array['brandy','diskin','john','kristi','macy'];
begin
  insert into organizations (name) values ('Chancey Heating & Cooling') returning id into v_org;

  foreach v_email in array v_names loop
    -- Insert the auth.users row
    v_user_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email || '@chancey.test',
      crypt('password123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(), now(), '', '', '', ''
    );

    -- Insert the auth.identities row so password login works
    insert into auth.identities (
      id, user_id, provider, provider_id, identity_data,
      last_sign_in_at, created_at, updated_at
    ) values (
      v_user_id,
      v_user_id,
      'email',
      v_user_id::text,
      json_build_object(
        'sub', v_user_id::text,
        'email', v_email || '@chancey.test',
        'email_verified', true
      ),
      now(), now(), now()
    );

    insert into memberships (org_id, user_id, role)
    values (v_org, v_user_id, case when v_email = 'diskin' then 'owner' else 'member' end);
  end loop;
end $$;
