import { handleAcceptableError, isAcceptableError } from "../src/errors";
import mock = jest.mock;

mock('../src/shutdown')

test("Check acceptable errors of isAcceptableError().", () => {
  expect(isAcceptableError({
                             name: "NoSuchKey",
                             code: "NoSuchKey"
                           })).toBeTruthy()
  expect(isAcceptableError({
                             name: "NoSuchKey",
                           })).toBeTruthy()
  expect(isAcceptableError({
                             code: "NoSuchKey"
                           })).toBeTruthy()
  expect(isAcceptableError({
                             code: "NoSuchKey"
                           }, {"ENOENT": {}, "EEXIST": {}})).toBeTruthy()
})

test("Check unacceptable errors of isAcceptableError().", () => {
  // make NoSuchKey unacceptable by excluding it
  expect(isAcceptableError({
                             code: "NoSuchKey"
                           }, {"NoSuchKey": {}, EEXIST: {}})).toBeFalsy()
  expect(isAcceptableError({
                             name: "whatever"
                           }, {"NoSuchKey": {}, EEXIST: {}})).toBeFalsy()
  expect(isAcceptableError({})).toBeFalsy()
  expect(isAcceptableError({
                             name: "whatever"
                           }, {"ENOENT": {}, EEXIST: {}})).toBeFalsy()
})

test("Check acceptable errors of handleAcceptableError().", async () => {
  await handleAcceptableError({
                                name: "ENOENT"
                              })
    .then(resp => {
      // pass
    })
    .catch(err => {
      fail(err)
    });

  await handleAcceptableError({
                                code: "ENOENT"
                              })
    .then(resp => {
      // pass
    })
    .catch(err => {
      fail(err)
    });

  await handleAcceptableError({
                                code: "EEXIST"
                              },
                              true,
                              {"ENOENT": false})  // can even use false so long as it's not undefined
    .then(resp => {
      // pass
    })
    .catch(err => {
      fail(err)
    });
})

test("Check unacceptable errors of handleAcceptableError().", async () => {

  await handleAcceptableError({
                                name: "should not be accepted"
                              })
    .then(resp => {
      fail("Should not have received response.")
    })
    .catch(err => {
      // pass
    });

  await handleAcceptableError({
                                name: "ENOENT"
                              },
                              true,
                              {"ENOENT": {}})
    .then(resp => {
      fail("Should not have received response.")
    })
    .catch(err => {
      // pass
    });

})
