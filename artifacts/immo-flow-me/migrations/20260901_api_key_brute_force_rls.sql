-- Der API-Key-Brute-Force-Store ist eine reine Systemtabelle. Zugriff erfolgt
-- ausschließlich über rootDb vor dem RLS-Org-Kontext; immo_app darf die
-- Sperrdaten weder lesen noch verändern.
ALTER TABLE api_key_brute_force ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_brute_force FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE api_key_brute_force FROM immo_app;