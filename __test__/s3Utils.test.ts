import { getS3List } from "../src/utils/s3Utils";
import { _Object, ListObjectsV2Command } from "@aws-sdk/client-s3";

function mockClientS3(contents: Array<Array<_Object>>) {
  jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn(() => {
      let sendCount = 0;
      return {
        send: jest.fn((command: any) => {
          if (command instanceof ListObjectsV2Command) {
            const Contents = contents[sendCount];
            return Promise.resolve({
                                     Contents,
                                     // dont want infinite loop. make sure called 3 times total (initial and 2 more continuation tokens sent)
                                     NextContinuationToken: sendCount++ < 2 ? "wait, there's more." : undefined
                                   });
          } else {
            throw new Error("Not handled.");
          }
        })
      }
    })
  }));
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
})

describe("getS3Lists tests", () => {

  /*
  * Simple list test.
  * */
  test("getS3List tests", async () => {

    mockClientS3([
                   [{Key: "a1"}, {Key: "a2"}, {Key: "a3"}],
                   [{Key: "b1"}, {Key: "b2"}, {Key: "b3"}],
                   [{Key: "c1"}, {Key: "c2"}, {Key: "c3"}],
                 ])

    const {S3Client} = require('@aws-sdk/client-s3');

    const s3Client = new S3Client({});

    const s3List = await getS3List({
                                     s3Client,
                                     Bucket: "whatever",
                                   });

    expect(s3List.length).toEqual(9);
    // should be called twice, because NextContinuationToken is provided
    expect(s3Client.send).toHaveBeenCalledTimes(3);

  });

  test("Ensure suffix is filtered out.", async () => {

    mockClientS3([
                   [{Key: "a1"}, {Key: "a2"}, {Key: "a3"}],
                   [{Key: "b1"}, {Key: "b2"}, {Key: "b3.txt"}],
                   [{Key: "c1.txt"}, {Key: "c2.txt"}, {Key: "c3"}],
                 ])

    const {S3Client} = require('@aws-sdk/client-s3');

    const s3Client = new S3Client({});

    const s3List = await getS3List({
                                     s3Client,
                                     Bucket: "whatever",
                                     suffix: ".txt"
                                   });


    expect(s3List.length).toEqual(3);
    // should be called twice, because NextContinuationToken is provided
    expect(s3Client.send).toHaveBeenCalledTimes(3);

  });

});

