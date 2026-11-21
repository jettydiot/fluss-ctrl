# Runbooks

Step-by-step procedures for operating Fluss Ctrl. Write one when you add something an operator
has to run or recover: a queue, a cron, a secret, a provider, a datastore (`CLAUDE.md`, "Docs and
change management").

A runbook is written for someone tired, at 03:00, who did not build the thing. Each one has:

1. **When to use it:** the alert, symptom or request that leads here.
2. **Impact:** who is affected and how badly, and the severity to declare (SPEC §21.6).
3. **Preconditions:** access, tools and approvals needed. Anything that changes production runs
   from CI after a human approval, never from a laptop or an agent session.
4. **Steps:** numbered, copy-pasteable, each with how to check it worked.
5. **Rollback:** how to undo each step.
6. **Afterwards:** who to tell, what to record, whether a postmortem is due
   ([`../postmortem-template.md`](../postmortem-template.md)).

## Runbooks

- [Database: roles and partitions](database.md)

## Planned runbooks (SPEC §16)

Each is written by the issue that introduces what it operates.

- Incident response
- Provider outage
- Dead-letter queue drain
- Key rotation and escrow
- Region add
- Database failover and failback
- Break-glass deploy
- DNS switch
- Drill log (`drill-log.md`, SPEC §11 item 17)
