declare module "sns-validator" {
  class MessageValidator {
    /**
     * @param hostPattern [hostPattern=/^sns\.[a-zA-Z0-9\-]{3,}\.amazonaws\.com(\.cn)?$/] - A pattern used to validate that a message's certificate originates from a trusted domain.
     * @param encoding [encoding='utf8'] - The encoding of the messages being signed.
     */
    constructor(hostPattern?: RegExp, encoding?: string)

    /**
     * Validates a message and returns it in the callback if it was successful.
     * @param message the message to check for validity
     * @param cb first arg is error if there is one, otherwise it is null. second arg will be the parsed JSON of the message
     */
    validate(message: string | any, cb: (error: Error | null, validatedMessage: any) => void): void
  }
  export = MessageValidator;
}