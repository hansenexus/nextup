import { describe, expect, it } from "vitest";
import {
  BLOCKED_BY_RE,
  issueTitle,
  itemMarker,
  parseBlockedBy,
  parseMarkers,
  renderIssueBody,
  taskMarker,
} from "./markers";
import type { Item, Task } from "./types";

describe("markers", () => {
  it("parses item and task markers, ignores other files' shape mistakes", () => {
    const body = [
      "some text",
      "Roadmap-item: roadmap.yaml#alpha-one",
      "Roadmap-task: apps/x/roadmap.yaml#alpha-one/task-1",
      "Roadmap-task: not-a-yaml#x/y",
      "  Roadmap-item: indented.yaml#nope",
    ].join("\n");
    expect(parseMarkers(body)).toEqual([
      { kind: "item", file: "roadmap.yaml", itemId: "alpha-one", taskId: null },
      { kind: "task", file: "apps/x/roadmap.yaml", itemId: "alpha-one", taskId: "task-1" },
    ]);
  });

  it("round-trips what it writes", () => {
    const body = `${itemMarker("roadmap.yaml", "a")}\n${taskMarker("roadmap.yaml", "a", "t")}\n`;
    expect(parseMarkers(body).map((m) => m.kind)).toEqual(["item", "task"]);
  });

  it("reads Blocked-by exactly the way fleetd does", () => {
    const body = "Blocked-by: #12\n- blocked by: #7\n> Blocked-By: #12\nBlocked-by: 5\n";
    expect(parseBlockedBy(body)).toEqual([12, 7]);
    // the regex is fleetd's: multiline, case-insensitive, list/quote prefixes allowed
    expect(BLOCKED_BY_RE.flags).toContain("m");
    expect(BLOCKED_BY_RE.flags).toContain("i");
  });

  it("renders a to-tickets shaped body with markers at the end", () => {
    const item = { id: "it", phase: "P0", description: "Item desc" } as unknown as Item;
    const task = {
      id: "t1",
      title: "Do it",
      acceptance: ["A1", "A2"],
      verify: ["bun test"],
      blocked_by: [],
      labels: [],
      fleet_env: null,
      interactive: false,
    } as Task;
    const body = renderIssueBody({
      file: "roadmap.yaml",
      item,
      task,
      blockedBy: [3, 4],
      publicUrl: "https://x.example/r",
    });
    expect(body).toMatch(/^## Description\n\nItem desc/);
    expect(body).toMatch(/## Acceptance Criteria\n\n- \[ \] A1\n- \[ \] A2/);
    expect(body).toMatch(/## Verification commands\n\n```\nbun test\n```/);
    expect(parseBlockedBy(body)).toEqual([3, 4]);
    expect(body).toMatch(
      /Roadmap-item: roadmap.yaml#it\nRoadmap-task: roadmap.yaml#it\/t1\nRoadmap: https:\/\/x.example\/r#it\n$/
    );
    expect(issueTitle(item, task)).toBe("[it] Do it");
  });
});
