import { expect, test } from "vitest";
import { parseLocalQueryRows } from "./local-query-json";

test("normalizes direct and wrapped local query row arrays", () => {
  expect(parseLocalQueryRows<{ name: string }>(`[{"name":"direct"}]`)).toEqual([{ name: "direct" }]);
  expect(parseLocalQueryRows<{ name: string }>(`{"rows":[{"name":"wrapped"}]}`)).toEqual([{ name: "wrapped" }]);
});

test("rejects invalid local query output instead of treating it as empty rows", () => {
  expect(() => parseLocalQueryRows("not-json")).toThrow(/invalid JSON/);
  expect(() => parseLocalQueryRows(`{"rows":{}}`)).toThrow(/row array/);
  expect(() => parseLocalQueryRows(`null`)).toThrow(/row array/);
  for (const malformedRows of ["[1]", '["row"]', "[null]", "[[]]", '{"rows":[1]}', '{"rows":["row"]}', '{"rows":[null]}', '{"rows":[[]]}']) {
    expect(() => parseLocalQueryRows(malformedRows)).toThrow(/non-null objects/);
  }
  expect(parseLocalQueryRows("[]")).toEqual([]);
  expect(parseLocalQueryRows('{"rows":[]}')).toEqual([]);
});
