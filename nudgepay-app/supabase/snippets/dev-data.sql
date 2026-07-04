-- Realistic dev data for Chancey Heating & Cooling
-- 24 customers, overdue invoices, collection cases, contact logs, promises.
-- Run AFTER seed.sql on a reset local DB.

DO $$
DECLARE
  v_org uuid := (SELECT id FROM organizations WHERE name LIKE '%Chancey%');
  v_diskin uuid := (SELECT user_id FROM memberships WHERE org_id = v_org AND user_id IN (SELECT id FROM auth.users WHERE email = 'diskin@chancey.test'));
  v_brandy uuid := (SELECT user_id FROM memberships WHERE org_id = v_org AND user_id IN (SELECT id FROM auth.users WHERE email = 'brandy@chancey.test'));
  v_john uuid := (SELECT user_id FROM memberships WHERE org_id = v_org AND user_id IN (SELECT id FROM auth.users WHERE email = 'john@chancey.test'));
  v_kristi uuid := (SELECT user_id FROM memberships WHERE org_id = v_org AND user_id IN (SELECT id FROM auth.users WHERE email = 'kristi@chancey.test'));
  v_macy uuid := (SELECT user_id FROM memberships WHERE org_id = v_org AND user_id IN (SELECT id FROM auth.users WHERE email = 'macy@chancey.test'));
  v_owners uuid[];
  v_cust_id uuid;
  v_inv_id uuid;
  v_case_id uuid;
  v_today date := current_date;
  v_i int;
  v_name text;
  v_names text[] := ARRAY[
    'Anderson Plumbing', 'Baker Construction', 'Carter Electric', 'Davis Roofing',
    'Evans Landscaping', 'Foster HVAC Supply', 'Garcia Properties', 'Harris & Sons Builders',
    'Irving Real Estate', 'Johnson Mechanical', 'Kelly Restoration', 'Lopez Painting Co',
    'Mitchell Drywall', 'Nelson Contracting', 'OBrien Insulation', 'Parker Flooring',
    'Quinn Demolition', 'Robinson Tile', 'Stevens Woodwork', 'Turner Concrete',
    'Underwood Fencing', 'Valdez Excavation', 'Williams Paving', 'Young Plumbing Supply'
  ];
  v_phones text[] := ARRAY[
    '+15551001001', '+15551001002', '+15551001003', '+15551001004',
    '+15551001005', '+15551001006', '+15551001007', '+15551001008',
    '+15551001009', '+15551001010', '+15551001011', '+15551001012',
    '+15551001013', '+15551001014', '+15551001015', '+15551001016',
    '+15551001017', '+15551001018', '+15551001019', '+15551001020',
    '+15551001021', '+15551001022', '+15551001023', '+15551001024'
  ];
  v_statuses text[] := ARRAY['new','new','working','working','working','working','promised','waiting','on_hold'];
  v_next_types text[] := ARRAY['contact','contact','follow_up','follow_up','follow_up','promise','waiting','exception'];
  v_status text;
  v_next_type text;
  v_due_offset int;
  v_amt numeric;
  v_owner uuid;
BEGIN
  v_owners := ARRAY[v_diskin, v_brandy, v_john, v_kristi, v_macy];

  FOR v_i IN 1..24 LOOP
    v_name := v_names[v_i];
    v_amt := (300 + (random() * 9700))::numeric(12,2);
    v_due_offset := (5 + (random() * 85))::int;
    v_status := v_statuses[1 + (v_i % array_length(v_statuses, 1))];
    v_next_type := CASE v_status
      WHEN 'on_hold' THEN 'exception'
      WHEN 'waiting' THEN 'waiting'
      WHEN 'promised' THEN 'promise'
      ELSE v_next_types[1 + (v_i % array_length(v_next_types, 1))]
    END;
    v_owner := v_owners[1 + (v_i % 5)];

    INSERT INTO customers (org_id, qbo_id, name, email, phone, sms_consent, owner)
    VALUES (
      v_org, 'QBO-C-' || v_i, v_name,
      lower(replace(v_name, ' ', '.')) || '@example.com',
      v_phones[v_i],
      v_i % 3 != 0,
      CASE WHEN v_i <= 15 THEN v_owner ELSE NULL END
    ) RETURNING id INTO v_cust_id;

    INSERT INTO invoices (org_id, qbo_id, qbo_doc_number, customer_id, amount, balance, due_date, invoice_date, status, qbo_sync_at)
    VALUES (
      v_org, 'QBO-I-' || (v_i * 10), 'INV-' || (1000 + v_i),
      v_cust_id, v_amt, v_amt,
      v_today - v_due_offset,
      v_today - v_due_offset - 30,
      'overdue', now()
    ) RETURNING id INTO v_inv_id;

    IF v_i % 3 = 0 THEN
      INSERT INTO invoices (org_id, qbo_id, qbo_doc_number, customer_id, amount, balance, due_date, invoice_date, status, qbo_sync_at)
      VALUES (
        v_org, 'QBO-I-' || (v_i * 10 + 1), 'INV-' || (2000 + v_i),
        v_cust_id, (v_amt * 0.3)::numeric(12,2), (v_amt * 0.3)::numeric(12,2),
        v_today - (v_due_offset - 10),
        v_today - (v_due_offset - 10) - 30,
        'overdue', now()
      );
    END IF;

    INSERT INTO collection_cases (org_id, customer_id, status, next_action_type, next_action_at, opened_at,
      exception_reason, priority_override)
    VALUES (
      v_org, v_cust_id, v_status, v_next_type,
      CASE
        WHEN v_next_type = 'contact' THEN v_today - (v_i % 5)
        WHEN v_next_type = 'follow_up' THEN v_today + (v_i % 7) - 3
        WHEN v_next_type = 'promise' THEN v_today + 5
        WHEN v_next_type = 'waiting' THEN v_today + 14
        ELSE NULL
      END,
      now() - (v_due_offset || ' days')::interval,
      CASE WHEN v_status = 'on_hold' THEN 'disputed' ELSE NULL END,
      CASE WHEN v_i = 1 THEN 'critical' WHEN v_i = 5 THEN 'high' ELSE NULL END
    ) RETURNING id INTO v_case_id;

    IF v_i % 4 != 0 THEN
      INSERT INTO contact_logs (org_id, case_id, customer_id, user_id, method, outcome, notes, follow_up_at, created_at)
      VALUES (
        v_org, v_case_id, v_cust_id, v_owner,
        CASE WHEN v_i % 2 = 0 THEN 'call' ELSE 'text' END,
        CASE WHEN v_i % 3 = 0 THEN 'no-answer' WHEN v_i % 3 = 1 THEN 'no-commitment' ELSE 'left-voicemail' END,
        CASE WHEN v_i % 5 = 0 THEN 'Customer said they would check with their accountant' ELSE NULL END,
        v_today + (v_i % 10),
        now() - ((v_due_offset / 2) || ' days')::interval
      );
    END IF;

    IF v_i % 6 = 0 THEN
      INSERT INTO contact_logs (org_id, case_id, customer_id, user_id, method, outcome, notes, created_at)
      VALUES (
        v_org, v_case_id, v_cust_id, v_owners[1 + ((v_i + 1) % 5)],
        'call', 'no-commitment', 'Spoke with AP. Said payment is in process.',
        now() - ((v_due_offset / 4) || ' days')::interval
      );
    END IF;

    IF v_status = 'promised' THEN
      INSERT INTO promises (org_id, case_id, customer_id, promised_amount, promised_date, grace_until, baseline_balance, status, created_at)
      VALUES (v_org, v_case_id, v_cust_id, v_amt, v_today + 7, v_today + 10, v_amt, 'pending', now() - '5 days'::interval);
    END IF;

    IF v_i % 5 = 0 THEN
      INSERT INTO text_messages (org_id, case_id, customer_id, invoice_id, direction, body, status, created_at)
      VALUES (
        v_org, v_case_id, v_cust_id, v_inv_id, 'outbound',
        'Hi ' || split_part(v_name, ' ', 1) || ', this is a friendly reminder that invoice INV-' || (1000 + v_i) || ' for $' || v_amt::text || ' is past due. Please contact us at your earliest convenience.',
        'delivered',
        now() - ((v_due_offset / 3) || ' days')::interval
      );
    END IF;

    IF v_i = 2 THEN
      UPDATE customers SET do_not_call = true, preferred_channel = 'text' WHERE id = v_cust_id;
    END IF;
    IF v_i = 8 THEN
      UPDATE customers SET do_not_text = true, preferred_channel = 'call' WHERE id = v_cust_id;
    END IF;
    IF v_i = 14 THEN
      UPDATE customers SET phone = NULL, sms_consent = false WHERE id = v_cust_id;
    END IF;
    IF v_i = 20 THEN
      UPDATE collection_cases SET exception_reason = 'do_not_contact', status = 'on_hold', next_action_type = 'exception' WHERE id = v_case_id;
    END IF;
    IF v_i = 12 THEN
      INSERT INTO promises (org_id, case_id, customer_id, promised_amount, promised_date, grace_until, baseline_balance, status, created_at, resolved_at)
      VALUES (v_org, v_case_id, v_cust_id, v_amt, v_today - 3, v_today, v_amt, 'broken', now() - '10 days'::interval, now() - '1 day'::interval);
    END IF;
  END LOOP;

  -- Add a couple coming-due (not yet overdue) invoices for the Coming Due view
  INSERT INTO invoices (org_id, qbo_id, qbo_doc_number, customer_id, amount, balance, due_date, invoice_date, status, qbo_sync_at)
  SELECT v_org, 'QBO-I-CD-' || row_number() OVER (), 'INV-CD-' || row_number() OVER (),
    c.id, (500 + random() * 2000)::numeric(12,2), (500 + random() * 2000)::numeric(12,2),
    v_today + (row_number() OVER ())::int + 1, v_today - 25, 'open', now()
  FROM customers c WHERE c.org_id = v_org LIMIT 4;

END $$;
