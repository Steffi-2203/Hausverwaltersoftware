---
name: Test-Seed-Muster: eindeutige E-Mails
description: Test-Fixtures dürfen fixe E-Mails nicht mit zufälligen Profil-IDs kombinieren
---
Regel: Test-Seeds für Profile müssen die E-Mail pro Lauf eindeutig machen, nicht nur die ID randomisieren.

**Why:** Abgebrochene Läufe hinterlassen ein Profil mit der fixen E-Mail und alter ID. Der nächste Lauf trifft auf den Unique-Konflikt, ON CONFLICT DO NOTHING überspringt still, und abhängige Inserts scheitern an der FK — die Testdatei hängt dann und cancelt den Rest der Suite. Aufräumen per DELETE scheitert oft an Audit-Log-Referenzen.

**How to apply:** Bei neuen Tests mit Profil-Seeds E-Mails pro Lauf eindeutig machen (z. B. Suffix aus der zufälligen ID). Bei mysteriösen FK-Fehlern auf user_roles/profiles in Tests zuerst nach fixen Seed-E-Mails suchen.
