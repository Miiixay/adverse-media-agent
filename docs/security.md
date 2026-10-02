# Security

Threat model and measures, written from `PLAN.md` section 16. This file is completed with the
rest of the documentation; the entries below are recorded as the decisions are taken.

## Test data

The fixed cases in `fixtures/test-cases.json` name only public figures whose cases were decided in
public hearings and widely reported: Bernard Madoff; Valérie Bozzi, a former mayor convicted in
2025, cassation pending; Marcus Held, a former mayor whose 2021 conviction is final. The others are
a fictional name and one of the most common names in Britain. No private individual is chosen as a
subject, and the full results of the cases stay in the gitignored `logs/`.
