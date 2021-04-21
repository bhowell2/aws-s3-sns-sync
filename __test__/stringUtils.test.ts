import {compareStringsUtf8BinaryOrder} from "../src/utils/stringUtils";

test("Check compareStringsUtf8BinaryOrder.", () => {
  expect(compareStringsUtf8BinaryOrder("a", "b")).toBeLessThan(0);
  expect(compareStringsUtf8BinaryOrder("b", "b")).toEqual(0);
  expect(compareStringsUtf8BinaryOrder("b", "a")).toBeGreaterThan(0);
});