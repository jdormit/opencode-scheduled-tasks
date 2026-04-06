import { describe, it, expect } from "bun:test";
import { parseSessionIdFromJsonOutput } from "../runner.js";

describe("parseSessionIdFromJsonOutput", () => {
  it("extracts session ID from session.created event", () => {
    const output = `{"type":"session.created","properties":{"info":{"id":"ses_abc123def456"}}}
{"type":"message.updated","properties":{}}`;

    expect(parseSessionIdFromJsonOutput(output)).toBe("ses_abc123def456");
  });

  it("extracts session ID from sessionID field", () => {
    const output = `{"sessionID":"ses_xyz789"}`;
    expect(parseSessionIdFromJsonOutput(output)).toBe("ses_xyz789");
  });

  it("extracts session ID from properties.sessionID", () => {
    const output = `{"type":"something","properties":{"sessionID":"ses_qrs456"}}`;
    expect(parseSessionIdFromJsonOutput(output)).toBe("ses_qrs456");
  });

  it("returns undefined for output without session ID", () => {
    const output = `{"type":"message.updated","properties":{}}
some non-json output`;
    expect(parseSessionIdFromJsonOutput(output)).toBeUndefined();
  });

  it("returns undefined for empty output", () => {
    expect(parseSessionIdFromJsonOutput("")).toBeUndefined();
  });

  it("handles mixed JSON and non-JSON lines", () => {
    const output = `Starting opencode...
{"type":"session.created","properties":{"info":{"id":"ses_found"}}}
Done.`;
    expect(parseSessionIdFromJsonOutput(output)).toBe("ses_found");
  });
});
