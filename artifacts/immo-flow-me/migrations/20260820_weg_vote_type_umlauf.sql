-- Migration: voteType für Umlaufbeschlüsse (§ 24 Abs. 1 WEG 2002)
-- Umlaufbeschlüsse erfordern Einstimmigkeit ALLER Eigentümer (kein Nein, keine Enthaltung).
-- Das neue Feld unterscheidet Versammlungsbeschlüsse von Umlaufbeschlüssen.
ALTER TABLE weg_votes
  ADD COLUMN IF NOT EXISTS vote_type TEXT NOT NULL DEFAULT 'versammlung';
