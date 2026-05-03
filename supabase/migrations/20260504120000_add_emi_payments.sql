-- EMI payment schedule tracker
CREATE TABLE IF NOT EXISTS emi_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             uuid NOT NULL REFERENCES credit_cases(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL,
  emi_number          integer NOT NULL,
  due_date            date NOT NULL,
  emi_amount          numeric(15,2) NOT NULL,
  principal_component numeric(15,2) NOT NULL,
  interest_component  numeric(15,2) NOT NULL,
  outstanding_balance numeric(15,2) NOT NULL,
  status              text NOT NULL DEFAULT 'pending', -- pending | paid | overdue | partial
  paid_amount         numeric(15,2),
  paid_date           date,
  remarks             text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (case_id, emi_number)
);

ALTER TABLE emi_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "emi_payments_owner" ON emi_payments
  FOR ALL USING (user_id = auth.uid());

CREATE INDEX emi_payments_case_id_idx ON emi_payments (case_id);
