const actual = require('@aws-sdk/client-sns');
const mockSns = jest.createMockFromModule("@aws-sdk/client-sns") as any;

mockSns.ConfirmSubscriptionCommand = actual.ConfirmSubscriptionCommand
mockSns.SubscribeCommand = actual.SubscribeCommand;
mockSns.UnsubscribeCommand = actual.UnsubscribeCommand;

module.exports = mockSns;
