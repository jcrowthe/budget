# Docs

One line per design doc, appended by each Build (merge=union).

- [Scaffold design](scaffold-design.md): the skeleton, Access, secrets, the plans slice, shell, deploy (spec: [scaffold-spec.md](scaffold-spec.md))
- [Conventions](conventions.md): how a feature Build adds a resource end to end (files, shared modules, product rules)
- [Scaffold polish](scaffold-polish.md): Designer polish list for the shell, with applied status
- [Profile completion design](profile-completion-design.md): clone.profile.json keys for Deploy, Discover and Test-flow; deploy phases, migrations-pending and live-test-plans scripts (spec: [profile-completion-spec.md](profile-completion-spec.md))
- [Worker hardening design](worker-hardening-design.md): EXF-453 HKDF secrets key, Worker-side Access identity pin, idempotency retry tests (spec: [worker-hardening-spec.md](worker-hardening-spec.md))
