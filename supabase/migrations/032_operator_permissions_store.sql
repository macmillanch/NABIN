/*
 * OP-1 - data-driven operator authorization store (ADDITIVE).
 *
 * Today the answer "what may this operator do" exists only in backend/src/adminPermissions.js,
 * and admin_accounts has no storage for a per-operator grant. This migration adds that storage
 * without changing what anyone can do: permission resolution stays in one server-side predicate,
 * and every existing account keeps exactly the set it has now.
 *
 * Generated from src/adminPermissions.js - do not hand-edit the seed rows below.
 *   permission catalogue : 55 keys (55 named in ROLE_GRANTS, 43 enforced by routes)
 *   roles                : 5 (the 5 that exist; OP-2 owns any new role)
 *   role grant rows      : 80
 *   operator_grants      : intentionally EMPTY - no existing account gains anything
 *
 * Keys enforced by a route but held by no role (0): none
 *   Those are catalogued so SUPER_ADMIN's wildcard stays representable; granting them to a
 *   non-super role is a matrix decision, not a migration decision.
 * Keys in a role list but not currently a route guard (12): audit.export, geofence.edit, identity_documents.download, identity_verification.approve, identity_verification.reject, identity_verification.request_resubmission, notification.view, promotion.activate, services.view, support.escalate, surge.activate, surge.edit
 *
 * Safety: additive only. No table is dropped, no account row is touched, and the fixed
 * 5-name CHECK on admin_accounts.role is REPLACED by a foreign key to operator_roles - a
 * stronger mechanism, because a role can then only be a value that exists as a row and a role
 * still in use by an account cannot be deleted.
 */

begin;

-- 1. Permission catalogue --------------------------------------------------------
create table if not exists public.permission_keys (
  id uuid primary key,
  key varchar(120) not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.permission_keys drop constraint if exists permission_keys_key_key;
alter table public.permission_keys add constraint permission_keys_key_key unique (key);
create index if not exists idx_permission_keys_active on public.permission_keys (is_active);

-- 2. Roles as data ---------------------------------------------------------------
create table if not exists public.operator_roles (
  id uuid primary key,
  role_key varchar(50) not null,
  name varchar(120) not null,
  is_system boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.operator_roles drop constraint if exists operator_roles_role_key_key;
alter table public.operator_roles add constraint operator_roles_role_key_key unique (role_key);

-- 3. Role -> permission (many to many; no JSON blobs, no CSV strings) --------------
-- id is a surrogate key so the store pages with the repository's own keyset reader
-- (readAllRows orders by id); the natural uniqueness is what actually forbids a role holding
-- the same permission twice.
create table if not exists public.role_grants (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.operator_roles (id) on delete cascade,
  permission_id uuid not null references public.permission_keys (id) on delete restrict,
  granted_by uuid references public.admin_accounts (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.role_grants drop constraint if exists role_grants_role_permission_key;
alter table public.role_grants add constraint role_grants_role_permission_key unique (role_id, permission_id);
create index if not exists idx_role_grants_permission on public.role_grants (permission_id);
create index if not exists idx_role_grants_role on public.role_grants (role_id);

-- 4. Per-operator additive grants --------------------------------------------------
-- Additive only at OP-1: the current authorization model has no concept of a deny entry, and
-- inventing one here would create semantics no predicate understands. Explicit deny/revoke
-- semantics are deferred and documented; revoking an additive grant removes the row.
create table if not exists public.operator_grants (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.admin_accounts (id) on delete cascade,
  permission_id uuid not null references public.permission_keys (id) on delete restrict,
  granted_by uuid references public.admin_accounts (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.operator_grants drop constraint if exists operator_grants_operator_permission_key;
alter table public.operator_grants add constraint operator_grants_operator_permission_key unique (operator_id, permission_id);
create index if not exists idx_operator_grants_permission on public.operator_grants (permission_id);
create index if not exists idx_operator_grants_operator on public.operator_grants (operator_id);

-- 5. Seed: permission catalogue ----------------------------------------------------
insert into public.permission_keys (id, key) values
  ('38052501-a288-4e84-86ca-e3f936cc33ff', 'admin_accounts.create'),
  ('1f828719-ab96-4e82-b69f-ebef57db20bf', 'admin_accounts.manage'),
  ('d3703f8e-a198-491d-93da-0456372ced15', 'advertisement.create'),
  ('59db3362-390d-4d6b-8cca-a93422cc2704', 'advertisement.delete'),
  ('014fae2b-ccbb-41d7-99f9-b3830d1c0ef3', 'advertisement.edit'),
  ('93d2c116-8047-4d15-abf3-3d7b25a0877e', 'audit.export'),
  ('c139f84c-d733-4a04-b499-a5ee9b1e8fe4', 'audit.view'),
  ('3b7b4253-0ae1-48dd-8bee-08385b6b117f', 'campaign.create'),
  ('297f92eb-40bb-47f5-84db-a26c580db0a2', 'campaign.delete'),
  ('ba4fead2-0484-4c83-9f3d-d0a53fa589d3', 'campaign.edit'),
  ('c4a278a1-480a-48b0-a3d7-0e9eadece62c', 'campaign.publish'),
  ('22d6f750-b1a9-4fa1-8e9d-0642519c0e75', 'campaign.view'),
  ('85a7e745-a745-4b13-ba57-e282f6ab5d01', 'catalog.manage'),
  ('bf6d7cb2-1f51-4284-aa96-eff113efe92e', 'customers.read'),
  ('969b1f3a-a04c-41e3-bb8d-9b0e41b23e0d', 'customers.suspend'),
  ('267312f6-bef9-4a46-8085-0f8f892bf87c', 'finance.adjust'),
  ('62886124-766b-4132-9644-cea5eef1c06d', 'finance.refund'),
  ('3be4eb8d-cc6e-48b0-82e8-35b50832aa3b', 'finance.settlement'),
  ('5b9f0968-93a5-41a8-a30c-506e0e330653', 'finance.view'),
  ('6d40203b-177e-4e3b-88d4-c6ee5c9325db', 'fleet.manage'),
  ('9b04f528-5e78-43ef-867e-015a15caea4e', 'geofence.create'),
  ('fe3256d5-86ba-42d6-8919-8040dfb3c0f2', 'geofence.delete'),
  ('9d8d7666-fd96-40c2-82a5-847d09f60863', 'geofence.edit'),
  ('cb45cc04-1684-43c8-a5a5-01ceaf10d316', 'geofence.view'),
  ('70fb7af3-ef45-4d13-88ce-68284bf2cb04', 'grocery.review'),
  ('8ace0212-77ae-45a4-88b6-22a7479d53d2', 'identity_documents.download'),
  ('35c5cb54-d8dc-4c6f-a9e2-c8ecf199ab65', 'identity_documents.view'),
  ('39654599-3e3f-4408-b343-6b2a675cd20d', 'identity_verification.approve'),
  ('75e5c0c0-447c-45d9-b60c-fda3d3ace010', 'identity_verification.reject'),
  ('c9f9e432-78cb-4295-a47b-d8018e0d688b', 'identity_verification.request_resubmission'),
  ('457865ce-e6c4-4d40-a6c4-650d6eadfe88', 'identity_verification.review'),
  ('416343c1-bc74-46da-9827-2d3d8f4f1420', 'identity_verification.view'),
  ('3a2875ef-8bbe-4fbe-b5fc-42ef84ddc65d', 'merchant.manage'),
  ('bda96547-0c1b-4d81-a287-39dc1b86a0fd', 'notification.broadcast'),
  ('1615ae30-2c6c-4bd6-8830-48c9120bc0d1', 'notification.view'),
  ('56ea4652-5d55-4e34-8568-1a9eb3277c5e', 'orders.manage'),
  ('59b37913-fd37-42e7-972b-67981b7184e3', 'pricing.edit'),
  ('25d09d39-4afe-4094-abba-0faef868e836', 'promotion.activate'),
  ('2a4bf488-76d6-44c8-bd4c-6d6da9bf0386', 'promotion.create'),
  ('26d8dcac-4d2f-40f5-ba5d-eb57772d8100', 'promotion.edit'),
  ('e3a9c7f6-32b0-4b7d-9e4b-d4f6d6be84b5', 'promotion.view'),
  ('ee592978-c916-47fa-baf7-723e38f4bf1f', 'security.session.revoke'),
  ('b031a7c7-7cd0-418f-a1aa-19fa785a000b', 'security.view'),
  ('59a3c765-6ff5-4224-b5e3-594f98202791', 'services.emergency_killswitch'),
  ('64ccbf77-0138-43a7-8b6a-d8100c5e48a4', 'services.pause'),
  ('d65f97f3-33b4-4f0a-867b-ffa6419a2450', 'services.resume'),
  ('99ab634e-fe74-4e95-92d4-e4a0273e009b', 'services.view'),
  ('2ce5b81e-db2a-42c9-94d8-13507554a210', 'support.escalate'),
  ('e90ec823-bb41-4170-bd59-646f321097a7', 'support.resolve'),
  ('4cc1d8e8-74ec-4256-a17b-25c6cd46529b', 'support.respond'),
  ('de56fba4-3dda-4010-8a75-7ab5b5a991f6', 'support.view'),
  ('74cdd374-445b-4834-87f5-8a53d76c66d3', 'surge.activate'),
  ('fef9b162-7dce-40da-bf4d-3b9a7190007a', 'surge.create'),
  ('c2787941-3feb-499b-9b1f-95faf54d45e9', 'surge.edit'),
  ('9632bd92-7dc6-49a0-856f-46e19ca592c3', 'surge.view')
on conflict (key) do nothing;

-- 6. Seed: the five roles that already exist ---------------------------------------
insert into public.operator_roles (id, role_key, name) values
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'SUPER_ADMIN', 'Super Administrator'),
  ('04e7dcb9-0777-4702-b6a4-b552d732de2d', 'KYC_SPECIALIST', 'KYC Specialist'),
  ('fafa14dc-ad83-4f65-873b-9c69f3447186', 'OPERATIONS', 'Operations'),
  ('ad701ea1-dffe-409d-b813-dc81dd2c8f96', 'FINANCE_AUDITOR', 'Finance Auditor'),
  ('e46de992-d517-4f7d-aa1c-52d769067f58', 'SUPPORT_AGENT', 'Support Agent')
on conflict (role_key) do nothing;

-- 7. Seed: role grants, byte-for-byte the mapping in adminPermissions.js -----------
insert into public.role_grants (role_id, permission_id) values
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '38052501-a288-4e84-86ca-e3f936cc33ff'),  -- SUPER_ADMIN : admin_accounts.create
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '1f828719-ab96-4e82-b69f-ebef57db20bf'),  -- SUPER_ADMIN : admin_accounts.manage
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'd3703f8e-a198-491d-93da-0456372ced15'),  -- SUPER_ADMIN : advertisement.create
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '59db3362-390d-4d6b-8cca-a93422cc2704'),  -- SUPER_ADMIN : advertisement.delete
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '014fae2b-ccbb-41d7-99f9-b3830d1c0ef3'),  -- SUPER_ADMIN : advertisement.edit
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '93d2c116-8047-4d15-abf3-3d7b25a0877e'),  -- SUPER_ADMIN : audit.export
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'c139f84c-d733-4a04-b499-a5ee9b1e8fe4'),  -- SUPER_ADMIN : audit.view
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '3b7b4253-0ae1-48dd-8bee-08385b6b117f'),  -- SUPER_ADMIN : campaign.create
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '297f92eb-40bb-47f5-84db-a26c580db0a2'),  -- SUPER_ADMIN : campaign.delete
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'ba4fead2-0484-4c83-9f3d-d0a53fa589d3'),  -- SUPER_ADMIN : campaign.edit
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'c4a278a1-480a-48b0-a3d7-0e9eadece62c'),  -- SUPER_ADMIN : campaign.publish
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '22d6f750-b1a9-4fa1-8e9d-0642519c0e75'),  -- SUPER_ADMIN : campaign.view
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '85a7e745-a745-4b13-ba57-e282f6ab5d01'),  -- SUPER_ADMIN : catalog.manage
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'bf6d7cb2-1f51-4284-aa96-eff113efe92e'),  -- SUPER_ADMIN : customers.read
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '969b1f3a-a04c-41e3-bb8d-9b0e41b23e0d'),  -- SUPER_ADMIN : customers.suspend
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '267312f6-bef9-4a46-8085-0f8f892bf87c'),  -- SUPER_ADMIN : finance.adjust
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '62886124-766b-4132-9644-cea5eef1c06d'),  -- SUPER_ADMIN : finance.refund
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '3be4eb8d-cc6e-48b0-82e8-35b50832aa3b'),  -- SUPER_ADMIN : finance.settlement
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '5b9f0968-93a5-41a8-a30c-506e0e330653'),  -- SUPER_ADMIN : finance.view
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '6d40203b-177e-4e3b-88d4-c6ee5c9325db'),  -- SUPER_ADMIN : fleet.manage
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '9b04f528-5e78-43ef-867e-015a15caea4e'),  -- SUPER_ADMIN : geofence.create
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'fe3256d5-86ba-42d6-8919-8040dfb3c0f2'),  -- SUPER_ADMIN : geofence.delete
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '9d8d7666-fd96-40c2-82a5-847d09f60863'),  -- SUPER_ADMIN : geofence.edit
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'cb45cc04-1684-43c8-a5a5-01ceaf10d316'),  -- SUPER_ADMIN : geofence.view
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '70fb7af3-ef45-4d13-88ce-68284bf2cb04'),  -- SUPER_ADMIN : grocery.review
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '8ace0212-77ae-45a4-88b6-22a7479d53d2'),  -- SUPER_ADMIN : identity_documents.download
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '35c5cb54-d8dc-4c6f-a9e2-c8ecf199ab65'),  -- SUPER_ADMIN : identity_documents.view
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '39654599-3e3f-4408-b343-6b2a675cd20d'),  -- SUPER_ADMIN : identity_verification.approve
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '75e5c0c0-447c-45d9-b60c-fda3d3ace010'),  -- SUPER_ADMIN : identity_verification.reject
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'c9f9e432-78cb-4295-a47b-d8018e0d688b'),  -- SUPER_ADMIN : identity_verification.request_resubmission
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '457865ce-e6c4-4d40-a6c4-650d6eadfe88'),  -- SUPER_ADMIN : identity_verification.review
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '416343c1-bc74-46da-9827-2d3d8f4f1420'),  -- SUPER_ADMIN : identity_verification.view
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '3a2875ef-8bbe-4fbe-b5fc-42ef84ddc65d'),  -- SUPER_ADMIN : merchant.manage
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'bda96547-0c1b-4d81-a287-39dc1b86a0fd'),  -- SUPER_ADMIN : notification.broadcast
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '1615ae30-2c6c-4bd6-8830-48c9120bc0d1'),  -- SUPER_ADMIN : notification.view
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '56ea4652-5d55-4e34-8568-1a9eb3277c5e'),  -- SUPER_ADMIN : orders.manage
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '59b37913-fd37-42e7-972b-67981b7184e3'),  -- SUPER_ADMIN : pricing.edit
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '25d09d39-4afe-4094-abba-0faef868e836'),  -- SUPER_ADMIN : promotion.activate
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '2a4bf488-76d6-44c8-bd4c-6d6da9bf0386'),  -- SUPER_ADMIN : promotion.create
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '26d8dcac-4d2f-40f5-ba5d-eb57772d8100'),  -- SUPER_ADMIN : promotion.edit
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'e3a9c7f6-32b0-4b7d-9e4b-d4f6d6be84b5'),  -- SUPER_ADMIN : promotion.view
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'ee592978-c916-47fa-baf7-723e38f4bf1f'),  -- SUPER_ADMIN : security.session.revoke
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'b031a7c7-7cd0-418f-a1aa-19fa785a000b'),  -- SUPER_ADMIN : security.view
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '59a3c765-6ff5-4224-b5e3-594f98202791'),  -- SUPER_ADMIN : services.emergency_killswitch
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '64ccbf77-0138-43a7-8b6a-d8100c5e48a4'),  -- SUPER_ADMIN : services.pause
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'd65f97f3-33b4-4f0a-867b-ffa6419a2450'),  -- SUPER_ADMIN : services.resume
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '99ab634e-fe74-4e95-92d4-e4a0273e009b'),  -- SUPER_ADMIN : services.view
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '2ce5b81e-db2a-42c9-94d8-13507554a210'),  -- SUPER_ADMIN : support.escalate
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'e90ec823-bb41-4170-bd59-646f321097a7'),  -- SUPER_ADMIN : support.resolve
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '4cc1d8e8-74ec-4256-a17b-25c6cd46529b'),  -- SUPER_ADMIN : support.respond
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'de56fba4-3dda-4010-8a75-7ab5b5a991f6'),  -- SUPER_ADMIN : support.view
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '74cdd374-445b-4834-87f5-8a53d76c66d3'),  -- SUPER_ADMIN : surge.activate
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'fef9b162-7dce-40da-bf4d-3b9a7190007a'),  -- SUPER_ADMIN : surge.create
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', 'c2787941-3feb-499b-9b1f-95faf54d45e9'),  -- SUPER_ADMIN : surge.edit
  ('33601cb2-b85d-46ae-b2b0-6676c95c9839', '9632bd92-7dc6-49a0-856f-46e19ca592c3'),  -- SUPER_ADMIN : surge.view
  ('04e7dcb9-0777-4702-b6a4-b552d732de2d', 'c139f84c-d733-4a04-b499-a5ee9b1e8fe4'),  -- KYC_SPECIALIST : audit.view
  ('04e7dcb9-0777-4702-b6a4-b552d732de2d', '35c5cb54-d8dc-4c6f-a9e2-c8ecf199ab65'),  -- KYC_SPECIALIST : identity_documents.view
  ('04e7dcb9-0777-4702-b6a4-b552d732de2d', '39654599-3e3f-4408-b343-6b2a675cd20d'),  -- KYC_SPECIALIST : identity_verification.approve
  ('04e7dcb9-0777-4702-b6a4-b552d732de2d', '75e5c0c0-447c-45d9-b60c-fda3d3ace010'),  -- KYC_SPECIALIST : identity_verification.reject
  ('04e7dcb9-0777-4702-b6a4-b552d732de2d', 'c9f9e432-78cb-4295-a47b-d8018e0d688b'),  -- KYC_SPECIALIST : identity_verification.request_resubmission
  ('04e7dcb9-0777-4702-b6a4-b552d732de2d', '457865ce-e6c4-4d40-a6c4-650d6eadfe88'),  -- KYC_SPECIALIST : identity_verification.review
  ('04e7dcb9-0777-4702-b6a4-b552d732de2d', '416343c1-bc74-46da-9827-2d3d8f4f1420'),  -- KYC_SPECIALIST : identity_verification.view
  ('fafa14dc-ad83-4f65-873b-9c69f3447186', 'bf6d7cb2-1f51-4284-aa96-eff113efe92e'),  -- OPERATIONS : customers.read
  ('fafa14dc-ad83-4f65-873b-9c69f3447186', '6d40203b-177e-4e3b-88d4-c6ee5c9325db'),  -- OPERATIONS : fleet.manage
  ('fafa14dc-ad83-4f65-873b-9c69f3447186', 'cb45cc04-1684-43c8-a5a5-01ceaf10d316'),  -- OPERATIONS : geofence.view
  ('fafa14dc-ad83-4f65-873b-9c69f3447186', '416343c1-bc74-46da-9827-2d3d8f4f1420'),  -- OPERATIONS : identity_verification.view
  ('fafa14dc-ad83-4f65-873b-9c69f3447186', '3a2875ef-8bbe-4fbe-b5fc-42ef84ddc65d'),  -- OPERATIONS : merchant.manage
  ('fafa14dc-ad83-4f65-873b-9c69f3447186', '4cc1d8e8-74ec-4256-a17b-25c6cd46529b'),  -- OPERATIONS : support.respond
  ('fafa14dc-ad83-4f65-873b-9c69f3447186', 'de56fba4-3dda-4010-8a75-7ab5b5a991f6'),  -- OPERATIONS : support.view
  ('fafa14dc-ad83-4f65-873b-9c69f3447186', '9632bd92-7dc6-49a0-856f-46e19ca592c3'),  -- OPERATIONS : surge.view
  ('ad701ea1-dffe-409d-b813-dc81dd2c8f96', 'c139f84c-d733-4a04-b499-a5ee9b1e8fe4'),  -- FINANCE_AUDITOR : audit.view
  ('ad701ea1-dffe-409d-b813-dc81dd2c8f96', '267312f6-bef9-4a46-8085-0f8f892bf87c'),  -- FINANCE_AUDITOR : finance.adjust
  ('ad701ea1-dffe-409d-b813-dc81dd2c8f96', '62886124-766b-4132-9644-cea5eef1c06d'),  -- FINANCE_AUDITOR : finance.refund
  ('ad701ea1-dffe-409d-b813-dc81dd2c8f96', '3be4eb8d-cc6e-48b0-82e8-35b50832aa3b'),  -- FINANCE_AUDITOR : finance.settlement
  ('ad701ea1-dffe-409d-b813-dc81dd2c8f96', '5b9f0968-93a5-41a8-a30c-506e0e330653'),  -- FINANCE_AUDITOR : finance.view
  ('e46de992-d517-4f7d-aa1c-52d769067f58', 'c139f84c-d733-4a04-b499-a5ee9b1e8fe4'),  -- SUPPORT_AGENT : audit.view
  ('e46de992-d517-4f7d-aa1c-52d769067f58', 'bf6d7cb2-1f51-4284-aa96-eff113efe92e'),  -- SUPPORT_AGENT : customers.read
  ('e46de992-d517-4f7d-aa1c-52d769067f58', 'e90ec823-bb41-4170-bd59-646f321097a7'),  -- SUPPORT_AGENT : support.resolve
  ('e46de992-d517-4f7d-aa1c-52d769067f58', '4cc1d8e8-74ec-4256-a17b-25c6cd46529b'),  -- SUPPORT_AGENT : support.respond
  ('e46de992-d517-4f7d-aa1c-52d769067f58', 'de56fba4-3dda-4010-8a75-7ab5b5a991f6')  -- SUPPORT_AGENT : support.view
on conflict (role_id, permission_id) do nothing;

-- 8. admin_accounts.role: replace the fixed CHECK with a foreign key ----------------
-- Seeded above first, so every existing role value is already a row and all 1,709 accounts
-- remain valid when the constraint swaps. Nothing is deleted.
alter table public.admin_accounts drop constraint if exists admin_accounts_role_check;
alter table public.admin_accounts
  add constraint admin_accounts_role_fkey
  foreign key (role) references public.operator_roles (role_key) on delete restrict;

-- 9. RLS - the 029/031 convention: enabled, zero policies, service_role only --------
-- Grant data is the privilege boundary. If a browser token could read it, an operator could
-- enumerate what the platform will let them try; if one could write it, they could grant
-- themselves anything. Neither is allowed, so neither is possible.
alter table public.permission_keys enable row level security;
revoke all on public.permission_keys from public, anon, authenticated;
grant usage on schema public to service_role;
grant all on public.permission_keys to service_role;
alter table public.operator_roles enable row level security;
revoke all on public.operator_roles from public, anon, authenticated;
grant usage on schema public to service_role;
grant all on public.operator_roles to service_role;
alter table public.role_grants enable row level security;
revoke all on public.role_grants from public, anon, authenticated;
grant usage on schema public to service_role;
grant all on public.role_grants to service_role;
alter table public.operator_grants enable row level security;
revoke all on public.operator_grants from public, anon, authenticated;
grant usage on schema public to service_role;
grant all on public.operator_grants to service_role;

commit;

-- Verification: the store must reproduce the code mapping exactly.
--   select count(*) from permission_keys;                       -- 55
--   select count(*) from operator_roles;                        -- 5
--   select count(*) from role_grants;                           -- 80
--   select count(*) from operator_grants;                       -- 0
