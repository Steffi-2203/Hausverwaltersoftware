-- WEG-Modul Fixes: paidAmount, wegVoteResults, nutzwert-Index

-- 1. Tatsächlich bezahlter Betrag bei Teilzahlungen
ALTER TABLE weg_vorschreibungen ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2);

-- 2. Persistierung von Abstimmungsergebnissen (Anteilsmehrheit + Kopfmehrheit)
CREATE TABLE IF NOT EXISTS weg_vote_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_id uuid NOT NULL REFERENCES weg_votes(id),
  passed boolean NOT NULL,
  quorum_reached boolean NOT NULL,
  yes_shares numeric(10,4),
  no_shares numeric(10,4),
  abstain_shares numeric(10,4),
  yes_count integer,
  no_count integer,
  abstain_count integer,
  result_text text,
  kopf_majority_reached boolean,
  kopf_result_text text,
  calculated_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_weg_vote_results_vote_id ON weg_vote_results(vote_id);
