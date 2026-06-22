-- Link messages to a customer (not only an invoice) so inbound replies that
-- can't be tied to a specific invoice still thread to the right customer, and
-- STOP/HELP handling can resolve the sender.
alter table text_messages
  add column customer_id uuid references customers(id) on delete set null;

-- Thread view: messages for an invoice, and for a customer.
create index text_messages_org_invoice_idx on text_messages (org_id, invoice_id);
create index text_messages_org_customer_idx on text_messages (org_id, customer_id);

-- Status callbacks arrive keyed by the Twilio message SID.
create index text_messages_sid_idx on text_messages (twilio_message_sid)
  where twilio_message_sid is not null;
