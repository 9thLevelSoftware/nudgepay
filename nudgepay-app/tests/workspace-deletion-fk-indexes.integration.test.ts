import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { assertSafeTestEnv } from "./load-env";
import { TEST_ENV } from "./helpers";

type IndexRow = {
  schema_name: string;
  table_name: string;
  index_name: string;
  access_method: string;
  is_ready: boolean;
  is_valid: boolean;
  is_partial: boolean;
  columns: string;
};

function queryLocalIndexes(): IndexRow[] {
  assertSafeTestEnv(TEST_ENV);
  const sqlPath = join(tmpdir(), `nudgepay-delete-indexes-${crypto.randomUUID()}.sql`);
  writeFileSync(sqlPath, `
    select index_namespace.nspname as schema_name,
           table_class.relname as table_name,
           index_class.relname as index_name,
           access_method.amname as access_method,
           index_data.indisready as is_ready,
           index_data.indisvalid as is_valid,
           index_data.indpred is not null as is_partial,
           pg_catalog.array_to_string(array(
             select attribute.attname
               from pg_catalog.unnest(index_data.indkey) with ordinality as key(attnum, position)
               join pg_catalog.pg_attribute attribute
                 on attribute.attrelid = index_data.indrelid
                and attribute.attnum = key.attnum
              order by key.position
           ), ',') as columns
      from pg_catalog.pg_index index_data
      join pg_catalog.pg_class index_class
        on index_class.oid = index_data.indexrelid
      join pg_catalog.pg_namespace index_namespace
        on index_namespace.oid = index_class.relnamespace
      join pg_catalog.pg_class table_class
        on table_class.oid = index_data.indrelid
      join pg_catalog.pg_am access_method
        on access_method.oid = index_class.relam
     where index_namespace.nspname = 'public'
       and index_class.relname in (
       'invoices_customer_org_fk_idx',
       'collection_cases_customer_org_fk_idx',
       'text_messages_invoice_org_fk_idx',
       'text_messages_customer_org_fk_idx',
       'text_messages_case_org_fk_idx',
       'contact_logs_invoice_org_fk_idx',
       'contact_logs_customer_org_fk_idx',
       'contact_logs_case_org_fk_idx',
       'email_messages_invoice_org_fk_idx',
       'email_messages_customer_org_fk_idx',
       'email_messages_case_org_fk_idx',
       'promises_case_org_fk_idx',
       'promises_customer_org_fk_idx',
       'promises_replacement_org_fk_idx',
       'promises_contact_log_org_fk_idx',
       'promise_invoices_invoice_org_fk_idx',
       'payments_customer_org_fk_idx'
     )
     order by index_class.relname;
  `);
  try {
    const raw = execFileSync(
      process.execPath,
      [
        resolve("node_modules/supabase/dist/supabase.js"),
        "db",
        "query",
        "--local",
        "--file",
        sqlPath,
        "--output",
        "json",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20_000,
        windowsHide: true,
      },
    );
    return (JSON.parse(raw) as { rows: IndexRow[] }).rows;
  } finally {
    unlinkSync(sqlPath);
  }
}

test("workspace deletion FK indexes are valid and keep referenced IDs first", () => {
  const expected = [
    ["invoices_customer_org_fk_idx", "invoices", "customer_id,org_id"],
    ["collection_cases_customer_org_fk_idx", "collection_cases", "customer_id,org_id"],
    ["text_messages_invoice_org_fk_idx", "text_messages", "invoice_id,org_id"],
    ["text_messages_customer_org_fk_idx", "text_messages", "customer_id,org_id"],
    ["text_messages_case_org_fk_idx", "text_messages", "case_id,org_id"],
    ["contact_logs_invoice_org_fk_idx", "contact_logs", "invoice_id,org_id"],
    ["contact_logs_customer_org_fk_idx", "contact_logs", "customer_id,org_id"],
    ["contact_logs_case_org_fk_idx", "contact_logs", "case_id,org_id"],
    ["email_messages_invoice_org_fk_idx", "email_messages", "invoice_id,org_id"],
    ["email_messages_customer_org_fk_idx", "email_messages", "customer_id,org_id"],
    ["email_messages_case_org_fk_idx", "email_messages", "case_id,org_id"],
    ["promises_case_org_fk_idx", "promises", "case_id,org_id"],
    ["promises_customer_org_fk_idx", "promises", "customer_id,org_id"],
    ["promises_replacement_org_fk_idx", "promises", "replacement_promise_id,org_id"],
    ["promises_contact_log_org_fk_idx", "promises", "contact_log_id,org_id"],
    ["promise_invoices_invoice_org_fk_idx", "promise_invoices", "invoice_id,org_id"],
    ["payments_customer_org_fk_idx", "payments", "customer_id,org_id"],
  ].map(([index_name, table_name, columns]) => ({
    schema_name: "public",
    table_name,
    index_name,
    access_method: "btree",
    is_ready: true,
    is_valid: true,
    is_partial: false,
    columns,
  })).sort((left, right) => left.index_name.localeCompare(right.index_name));

  expect(queryLocalIndexes()).toEqual(expected);
}, 20_000);
