---
title: MCP server
description: A read-only Model Context Protocol server over the roadmap.
---

```bash
npx @hansenexus/nextup mcp
```

speaks MCP on stdio. Register it with an agent runtime the way any stdio
server is registered — for Claude Code, a `.mcp.json` entry:

```json
{
  "mcpServers": {
    "nextup": { "command": "npx", "args": ["-y", "@hansenexus/nextup", "mcp"] }
  }
}
```

## Tools

| tool | returns |
|---|---|
| `nextup_phases` | the ordered phases with horizon and progress |
| `nextup_list_items` | items with status, horizon and phase; filter by phase, status or horizon |
| `nextup_item` | one item in full: tasks, linked issues, dependencies, reasons |
| `nextup_next` | the frontier — items in the current phase whose dependencies are done, with the tasks whose blockers are closed |
| `nextup_status` | the whole rollup, including warnings and orphans |

Results come from the same rollup the CLI prints, cached for a few minutes so
an agent asking five questions in a row costs one GitHub round-trip.

## No write tool, on purpose

The server cannot create issues, change labels or edit the file. Dispatch is
a human-approved step: an agent that wants an item dispatched says so, and a
person runs `nextup dispatch <item> --apply` (or a skill that asks first).
Issues are the tracker of record; a roadmap file is direction. Keeping the
MCP surface read-only is what lets it run unattended in any lane.
