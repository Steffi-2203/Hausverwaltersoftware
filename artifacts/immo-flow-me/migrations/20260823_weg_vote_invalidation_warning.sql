-- Task #81: Protokoll-Fälschungserkennung bei Umlaufbeschluss
-- Speichert einen Hinweistext wenn ein zuvor angenommener Umlaufbeschluss
-- nachträglich auf passed=false fällt (§ 24 Abs. 1 WEG 2002).
ALTER TABLE weg_vote_results
  ADD COLUMN IF NOT EXISTS invalidation_warning text;
